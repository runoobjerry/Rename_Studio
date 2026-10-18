import asyncio
import base64
import hashlib
import secrets
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx
from pydantic import BaseModel, Field, SecretStr, ValidationError as ModelValidationError

from app.core.errors import AuthenticationError, ProviderError, RateLimitError, StorageConnectionChangedError, ValidationError
from app.schemas.storage import AuthorizationStart, AuthorizationStatus


AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ABOUT_URL = "https://www.googleapis.com/drive/v3/about"
SCOPE = "https://www.googleapis.com/auth/drive.metadata"


class _TokenResponse(BaseModel):
    access_token: SecretStr = Field(min_length=1)
    refresh_token: SecretStr | None = Field(default=None, min_length=1)
    expires_in: int = Field(gt=0)
    scope: str | None = None


class _GoogleUser(BaseModel):
    permissionId: str = Field(min_length=1)
    displayName: str | None = None
    emailAddress: str | None = None


class _AboutResponse(BaseModel):
    user: _GoogleUser


@dataclass(frozen=True, slots=True)
class _PendingAuthorization:
    state: str
    verifier: str = field(repr=False)
    redirect_uri: str
    expires_at: datetime
    generation: int


@dataclass(frozen=True, slots=True)
class _Session:
    access_token: str = field(repr=False)
    refresh_token: str = field(repr=False)
    expires_at: datetime
    scope: str
    account_id: str
    display_name: str | None
    email: str | None


class GoogleDriveAuthService:
    def __init__(
        self,
        redirect_uri: str,
        *,
        client_id: str | None,
        credentials: dict[str, str],
        persist: Callable[[dict[str, object], dict[str, str]], None],
        before_change: Callable[[], None],
        timeout: float = 20.0,
    ) -> None:
        self.redirect_uri = redirect_uri
        self.timeout = timeout
        self._client_id = client_id
        self._client_secret = credentials.get("client_secret")
        self._persist = persist
        self._before_change = before_change
        self._generation = 0
        self._pending: _PendingAuthorization | None = None
        self._refresh_lock = asyncio.Lock()
        self._session: _Session | None = None
        if self.configured and credentials.get("refresh_token"):
            # Access tokens never reach disk; the first request after restart refreshes them.
            self._session = _Session(
                access_token="", refresh_token=credentials["refresh_token"],
                expires_at=datetime.now(UTC), scope=credentials["scope"],
                account_id=credentials["account_id"],
                display_name=credentials.get("account_display_name"),
                email=credentials.get("account_email"),
            )

    @property
    def configured(self) -> bool:
        return bool(self._client_id and self._client_secret)

    def status(self) -> AuthorizationStatus:
        session = self._session
        return AuthorizationStatus(
            configured=self.configured, connected=session is not None,
            account_id=session.account_id if session else None,
            account_display_name=session.display_name if session else None,
            account_email=session.email if session else None,
        )

    def disconnect(self) -> None:
        self._before_change()
        self._clear_session()

    def _clear_session(self) -> None:
        self._save_session(None)
        self._generation += 1
        self._pending = None

    def start_authorization(self, redirect_uri: str | None = None) -> AuthorizationStart:
        client_id, _ = self._require_client_credentials()
        self.disconnect()
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
        pending = _PendingAuthorization(
            state=state, verifier=verifier, redirect_uri=redirect_uri or self.redirect_uri,
            expires_at=datetime.now(UTC) + timedelta(minutes=10), generation=self._generation,
        )
        self._pending = pending
        query = urlencode({
            "client_id": client_id, "response_type": "code", "redirect_uri": pending.redirect_uri,
            "scope": SCOPE, "state": state, "code_challenge": challenge,
            "code_challenge_method": "S256", "access_type": "offline",
            # A new login discards the old account grant, so request a fresh offline grant.
            "prompt": "consent select_account",
        })
        return AuthorizationStart(authorization_url=f"{AUTHORIZE_URL}?{query}")

    async def finish_authorization(self, code: str, state: str) -> None:
        self._before_change()
        pending = self._pending
        if pending is None or pending.state != state or pending.expires_at <= datetime.now(UTC):
            raise AuthenticationError("Google authorization state is invalid or expired")
        self._pending = None
        client_id, client_secret = self._require_client_credentials()
        payload = await self._token_request({
            "client_id": client_id, "client_secret": client_secret,
            "code": code, "grant_type": "authorization_code",
            "redirect_uri": pending.redirect_uri, "code_verifier": pending.verifier,
        })
        self._check_generation(pending.generation)
        self._before_change()
        self._require_scope(payload.scope)
        if payload.refresh_token is None:
            raise AuthenticationError("Google did not grant offline access; connect again")
        expires_at = datetime.now(UTC) + timedelta(seconds=payload.expires_in)
        user = await self._load_account_profile(payload.access_token.get_secret_value())
        self._check_generation(pending.generation)
        self._before_change()
        # Publish the account only after both identity verification and atomic persistence succeed.
        self._save_session(_Session(
            access_token=payload.access_token.get_secret_value(),
            refresh_token=payload.refresh_token.get_secret_value(),
            expires_at=expires_at,
            scope=SCOPE, account_id=user.permissionId,
            display_name=user.displayName, email=user.emailAddress,
        ))

    async def access_token(self, *, force_refresh: bool = False) -> str:
        session = self._require_session()
        if force_refresh or session.expires_at <= datetime.now(UTC) + timedelta(seconds=60):
            async with self._refresh_lock:
                current = self._require_session()
                if current is session:
                    await self._refresh_access_token(current)
        return self._require_session().access_token

    async def _refresh_access_token(self, previous: _Session) -> None:
        client_id, client_secret = self._require_client_credentials()
        generation = self._generation
        try:
            payload = await self._token_request({
                "client_id": client_id, "client_secret": client_secret,
                "grant_type": "refresh_token", "refresh_token": previous.refresh_token,
            })
            self._require_scope(payload.scope if payload.scope is not None else previous.scope)
        except AuthenticationError:
            self._check_generation(generation)
            # Revocation may be detected during execution; it must invalidate that connection.
            self._clear_session()
            raise
        self._check_generation(generation)
        self._save_session(_Session(
            access_token=payload.access_token.get_secret_value(),
            refresh_token=payload.refresh_token.get_secret_value() if payload.refresh_token else previous.refresh_token,
            expires_at=datetime.now(UTC) + timedelta(seconds=payload.expires_in),
            scope=SCOPE, account_id=previous.account_id,
            display_name=previous.display_name, email=previous.email,
        ))

    async def _token_request(self, form: dict[str, str]) -> _TokenResponse:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(TOKEN_URL, data=form)
        except httpx.HTTPError as exc:
            raise ProviderError("Google authorization service is unavailable") from exc
        if response.status_code == 429:
            raise RateLimitError("Google authorization service is rate limited; try again later")
        if response.status_code >= 500:
            raise ProviderError("Google authorization service is unavailable")
        if response.is_error:
            # Do not reflect Google's response body: it can contain credential-related input.
            raise AuthenticationError("Google authorization was rejected; check the client credentials and reconnect")
        try:
            return _TokenResponse.model_validate_json(response.content)
        except ModelValidationError:
            raise ProviderError("Google returned invalid token data") from None

    async def _load_account_profile(self, access_token: str) -> _GoogleUser:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    ABOUT_URL, params={"fields": "user(permissionId,displayName,emailAddress)"},
                    headers={"Authorization": f"Bearer {access_token}"},
                )
        except httpx.HTTPError as exc:
            raise ProviderError("Google Drive account service is unavailable") from exc
        if response.status_code == 429:
            raise RateLimitError("Google Drive account service is rate limited; try again later")
        if response.status_code in (401, 403):
            raise AuthenticationError("Could not verify Google Drive account access")
        if response.is_error:
            raise ProviderError("Could not read the Google Drive account")
        try:
            return _AboutResponse.model_validate_json(response.content).user
        except ModelValidationError:
            raise ProviderError("Google Drive returned invalid account data") from None

    def _save_session(self, session: _Session | None) -> None:
        credentials = {"client_secret": self._client_secret} if self._client_secret is not None else {}
        if session is not None:
            credentials.update({
                "refresh_token": session.refresh_token, "scope": session.scope,
                "account_id": session.account_id,
            })
            if session.display_name is not None:
                credentials["account_display_name"] = session.display_name
            if session.email is not None:
                credentials["account_email"] = session.email
        self._persist({"client_id": self._client_id}, credentials)
        self._session = session

    def _require_client_credentials(self) -> tuple[str, str]:
        if not self._client_id or not self._client_secret:
            raise ValidationError("Configure both Google OAuth Client ID and Client Secret first")
        return self._client_id, self._client_secret

    def _require_session(self) -> _Session:
        if self._session is None:
            raise AuthenticationError("Google Drive account is not connected")
        return self._session

    def _check_generation(self, generation: int) -> None:
        if generation != self._generation:
            raise StorageConnectionChangedError("Storage changed during Google authorization")

    @staticmethod
    def _require_scope(scope: str | None) -> None:
        if scope is None or SCOPE not in scope.split():
            raise AuthenticationError("Google Drive metadata permission was not granted; connect again")
