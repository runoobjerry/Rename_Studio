import base64
import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx

from app.core.errors import AuthenticationError, ProviderError, ValidationError
from app.schemas.onedrive import (
    OneDriveAuthStartResponse,
    OneDriveAuthStatus,
    OneDriveSettingsResponse,
)


AUTHORIZE_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize"
TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
SCOPES = "offline_access Files.ReadWrite"


@dataclass(slots=True)
class PendingAuthorization:
    code_verifier: str
    expires_at: datetime


@dataclass(slots=True)
class TokenSet:
    access_token: str
    refresh_token: str | None
    expires_at: datetime


class OneDriveAuthService:
    def __init__(self, redirect_uri: str, *, timeout: float = 20.0) -> None:
        self.redirect_uri = redirect_uri
        self.timeout = timeout
        self._client_id: str | None = None
        self._client_secret: str | None = None
        self._tokens: TokenSet | None = None
        self._pending: dict[str, PendingAuthorization] = {}

    def settings(self) -> OneDriveSettingsResponse:
        return OneDriveSettingsResponse(
            configured=self.configured,
            client_id=self._client_id,
            client_secret_configured=self._client_secret is not None,
            redirect_uri=self.redirect_uri,
        )

    def status(self) -> OneDriveAuthStatus:
        return OneDriveAuthStatus(
            configured=self.configured,
            connected=self._tokens is not None,
        )

    @property
    def configured(self) -> bool:
        return bool(self._client_id and self._client_secret)

    def configure(self, client_id: str, client_secret: str) -> OneDriveSettingsResponse:
        client_id = client_id.strip()
        if not client_id or not client_secret:
            raise ValidationError("OneDrive App ID and client secret are required")
        self._client_id = client_id
        self._client_secret = client_secret
        # 更换应用凭据后，旧授权上下文和令牌都不可继续使用。
        self._tokens = None
        self._pending.clear()
        return self.settings()

    def clear(self) -> None:
        self._client_id = None
        self._client_secret = None
        self._tokens = None
        self._pending.clear()

    def start_authorization(self) -> OneDriveAuthStartResponse:
        client_id, _ = self._credentials()
        self._purge_expired_states()
        # 本地单用户界面只保留最新流程，限制无效 state 的内存增长。
        self._pending.clear()
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")
        self._pending[state] = PendingAuthorization(
            code_verifier=verifier,
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
        )
        query = urlencode(
            {
                "client_id": client_id,
                "response_type": "code",
                "redirect_uri": self.redirect_uri,
                "response_mode": "query",
                "scope": SCOPES,
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
        return OneDriveAuthStartResponse(authorization_url=f"{AUTHORIZE_URL}?{query}")

    async def finish_authorization(self, code: str, state: str) -> None:
        self._purge_expired_states()
        pending = self._pending.pop(state, None)
        if pending is None:
            raise AuthenticationError("OneDrive authorization state is invalid or expired")
        client_id, client_secret = self._credentials()
        payload = await self._token_request(
            {
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": self.redirect_uri,
                "grant_type": "authorization_code",
                "code_verifier": pending.code_verifier,
                "scope": SCOPES,
            }
        )
        self._store_tokens(payload)

    async def access_token(self, *, force_refresh: bool = False) -> str:
        if self._tokens is None:
            raise AuthenticationError("OneDrive account is not connected")
        expires_soon = self._tokens.expires_at <= datetime.now(UTC) + timedelta(
            seconds=60
        )
        if force_refresh or expires_soon:
            await self._refresh_access_token()
        if self._tokens is None:
            raise AuthenticationError("OneDrive account is not connected")
        return self._tokens.access_token

    async def _refresh_access_token(self) -> None:
        if self._tokens is None or not self._tokens.refresh_token:
            self._tokens = None
            raise AuthenticationError("OneDrive authorization expired; connect again")
        client_id, client_secret = self._credentials()
        previous_refresh_token = self._tokens.refresh_token
        try:
            payload = await self._token_request(
                {
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "refresh_token": previous_refresh_token,
                    "grant_type": "refresh_token",
                    "scope": SCOPES,
                }
            )
        except AuthenticationError:
            self._tokens = None
            raise
        self._store_tokens(payload, fallback_refresh_token=previous_refresh_token)

    async def _token_request(self, form: dict[str, str]) -> dict[str, object]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(TOKEN_URL, data=form)
        except httpx.HTTPError as exc:
            raise ProviderError("Microsoft identity service is unavailable") from exc
        try:
            payload = response.json()
        except ValueError as exc:
            raise ProviderError("Microsoft identity service returned invalid data") from exc
        if not isinstance(payload, dict):
            raise ProviderError("Microsoft identity service returned invalid data")
        if response.is_error:
            message = payload.get("error_description")
            raise AuthenticationError(
                str(message) if message else "OneDrive authorization failed"
            )
        return payload

    def _store_tokens(
        self,
        payload: dict[str, object],
        *,
        fallback_refresh_token: str | None = None,
    ) -> None:
        access_token = payload.get("access_token")
        refresh_token = payload.get("refresh_token", fallback_refresh_token)
        expires_in = payload.get("expires_in", 3600)
        if not isinstance(access_token, str) or not access_token:
            raise AuthenticationError("Microsoft did not return an access token")
        if not isinstance(refresh_token, str):
            refresh_token = fallback_refresh_token
        if not isinstance(expires_in, (int, float)):
            expires_in = 3600
        self._tokens = TokenSet(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=datetime.now(UTC) + timedelta(seconds=max(0, int(expires_in))),
        )

    def _credentials(self) -> tuple[str, str]:
        if not self.configured or self._client_id is None or self._client_secret is None:
            raise ValidationError("Configure the OneDrive App ID and client secret first")
        return self._client_id, self._client_secret

    def _purge_expired_states(self) -> None:
        now = datetime.now(UTC)
        self._pending = {
            state: pending
            for state, pending in self._pending.items()
            if pending.expires_at > now
        }
