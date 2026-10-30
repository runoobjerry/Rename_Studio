import asyncio
import base64
import hashlib
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx

from app.core.errors import AuthenticationError, ProviderError, StorageConnectionChangedError, ValidationError
from app.schemas.storage import AuthorizationStart, AuthorizationStatus


AUTHORIZE_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize"
TOKEN_URL = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
GRAPH_ME_URL = (
    "https://graph.microsoft.com/v1.0/me"
    "?$select=id,displayName,mail,userPrincipalName"
)
SCOPES = "offline_access Files.ReadWrite User.Read"


@dataclass(slots=True)
class PendingAuthorization:
    code_verifier: str
    expires_at: datetime
    redirect_uri: str
    generation: int


@dataclass(slots=True)
class TokenSet:
    access_token: str
    refresh_token: str | None
    expires_at: datetime


class OneDriveAuthService:
    def __init__(
        self,
        redirect_uri: str,
        *,
        timeout: float = 20.0,
        initial_state: dict[str, str],
        persist: Callable[[dict[str, str]], None],
        before_change: Callable[[], None] | None = None,
    ) -> None:
        self.redirect_uri = redirect_uri
        self.timeout = timeout
        self._initial_state = initial_state
        self._persist = persist
        self._before_change = before_change
        self._generation = 0
        self._finishing = False
        self._client_id: str | None = None
        self._tokens: TokenSet | None = None
        self._account_id: str | None = None
        self._account_display_name: str | None = None
        self._account_email: str | None = None
        self._pending: dict[str, PendingAuthorization] = {}
        self._refresh_lock = asyncio.Lock()
        self._load_credentials()

    def status(self) -> AuthorizationStatus:
        return AuthorizationStatus(
            configured=self.configured,
            connected=self._tokens is not None and not self._finishing,
            account_id=self._account_id,
            account_display_name=self._account_display_name,
            account_email=self._account_email,
        )

    @property
    def configured(self) -> bool:
        return bool(self._client_id)

    def disconnect(self) -> None:
        """Remove persisted account authorization while retaining the App ID."""
        if self._before_change is not None:
            self._before_change()
        self._generation += 1
        self._tokens = None
        self._account_id = None
        self._account_display_name = None
        self._account_email = None
        self._pending.clear()
        self._save_state()

    def start_authorization(self, redirect_uri: str | None = None) -> AuthorizationStart:
        client_id = self._require_client_id()
        # Keep the committed account until the replacement authorization is accepted.
        if self._before_change is not None:
            self._before_change()
        self._generation += 1
        self._pending.clear()
        # 本地单用户界面只保留最新流程，限制无效 state 的内存增长。
        state = secrets.token_urlsafe(32)
        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(
            hashlib.sha256(verifier.encode("ascii")).digest()
        ).rstrip(b"=").decode("ascii")
        self._pending[state] = PendingAuthorization(
            code_verifier=verifier,
            expires_at=datetime.now(UTC) + timedelta(minutes=10),
            redirect_uri=redirect_uri or self.redirect_uri,
            generation=self._generation,
        )
        query = urlencode(
            {
                "client_id": client_id,
                "response_type": "code",
                "redirect_uri": redirect_uri or self.redirect_uri,
                "response_mode": "query",
                "scope": SCOPES,
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
                # 始终显示账号选择器，避免浏览器静默复用错误的微软账号。
                "prompt": "select_account",
            }
        )
        return AuthorizationStart(authorization_url=f"{AUTHORIZE_URL}?{query}")

    async def finish_authorization(self, code: str, state: str) -> None:
        if self._before_change is not None:
            self._before_change()
        self._purge_expired_states()
        pending = self._pending.pop(state, None)
        if pending is None:
            raise AuthenticationError("OneDrive authorization state is invalid or expired")
        client_id = self._require_client_id()
        previous_session = (
            self._tokens, self._account_id, self._account_display_name, self._account_email
        )
        committed = False
        self._finishing = True
        try:
            payload = await self._token_request(
                {
                    "client_id": client_id,
                    "code": code,
                    "redirect_uri": pending.redirect_uri,
                    "grant_type": "authorization_code",
                    "code_verifier": pending.code_verifier,
                    "scope": SCOPES,
                }
            )
            if pending.generation != self._generation:
                raise StorageConnectionChangedError("Storage changed during authorization")
            if self._before_change is not None:
                self._before_change()
            self._store_tokens(payload, persist=False)
            await self._load_account_profile()
            if pending.generation != self._generation:
                raise StorageConnectionChangedError("Storage changed during authorization")
            if self._before_change is not None:
                self._before_change()
            self._save_state()
            committed = True
        finally:
            # A rejected callback must not expose tokens that were never committed.
            # A newer configure/disconnect operation owns its own session instead.
            if not committed and pending.generation == self._generation:
                (
                    self._tokens, self._account_id,
                    self._account_display_name, self._account_email,
                ) = previous_session
            self._finishing = False

    async def access_token(self, *, force_refresh: bool = False) -> str:
        if self._finishing:
            raise AuthenticationError("OneDrive authorization is still being completed")
        if self._tokens is None:
            raise AuthenticationError("OneDrive account is not connected")
        token_before_refresh = self._tokens.access_token
        expires_soon = self._tokens.expires_at <= datetime.now(UTC) + timedelta(
            seconds=60
        )
        if force_refresh or expires_soon:
            # 并发批次共用一次刷新，避免刷新令牌被重复轮换。
            async with self._refresh_lock:
                if self._tokens is None:
                    raise AuthenticationError("OneDrive account is not connected")
                token_was_refreshed = (
                    self._tokens.access_token != token_before_refresh
                )
                expires_soon = (
                    self._tokens.expires_at
                    <= datetime.now(UTC) + timedelta(seconds=60)
                )
                if not token_was_refreshed and (force_refresh or expires_soon):
                    await self._refresh_access_token()
        if self._tokens is None:
            raise AuthenticationError("OneDrive account is not connected")
        return self._tokens.access_token

    async def _refresh_access_token(self) -> None:
        if self._tokens is None or not self._tokens.refresh_token:
            self._expire_session()
            raise AuthenticationError("OneDrive authorization expired; connect again")
        client_id = self._require_client_id()
        previous_refresh_token = self._tokens.refresh_token
        generation = self._generation
        try:
            payload = await self._token_request(
                {
                    "client_id": client_id,
                    "refresh_token": previous_refresh_token,
                    "grant_type": "refresh_token",
                    "scope": SCOPES,
                }
            )
        except AuthenticationError:
            self._expire_session()
            raise
        if generation != self._generation:
            raise StorageConnectionChangedError("Storage changed during token refresh")
        self._store_tokens(payload, fallback_refresh_token=previous_refresh_token)

    def _expire_session(self) -> None:
        # Provider-detected revocation can occur during execution; user edits remain blocked.
        self._generation += 1
        self._tokens = None
        self._account_id = None
        self._account_display_name = None
        self._account_email = None
        self._pending.clear()
        self._save_state()

    async def _load_account_profile(self) -> None:
        generation = self._generation
        if self._tokens is None:
            raise AuthenticationError("OneDrive account is not connected")
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    GRAPH_ME_URL,
                    headers={"Authorization": f"Bearer {self._tokens.access_token}"},
                )
        except httpx.HTTPError as exc:
            raise ProviderError("Microsoft Graph is unavailable") from exc
        try:
            payload = response.json()
        except ValueError as exc:
            raise ProviderError("Microsoft Graph returned invalid account data") from exc
        if response.is_error or not isinstance(payload, dict):
            raise AuthenticationError("Could not verify the connected Microsoft account")
        if generation != self._generation:
            raise StorageConnectionChangedError("Storage changed while reading the account profile")
        # Graph 用户 ID 是账号标识，不是应用 client_id 或云盘 drive ID。
        account_id = payload.get("id")
        if not isinstance(account_id, str) or not account_id:
            raise AuthenticationError("Microsoft Graph did not return an account ID")
        self._account_id = account_id
        display_name = payload.get("displayName")
        mail = payload.get("mail")
        principal_name = payload.get("userPrincipalName")
        self._account_display_name = (
            display_name if isinstance(display_name, str) and display_name else None
        )
        self._account_email = (
            mail
            if isinstance(mail, str) and mail
            else principal_name
            if isinstance(principal_name, str) and principal_name
            else None
        )

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
        persist: bool = True,
    ) -> None:
        access_token = payload.get("access_token")
        refresh_token = payload.get("refresh_token", fallback_refresh_token)
        expires_in = payload.get("expires_in", 3600)
        if not isinstance(access_token, str) or not access_token:
            raise AuthenticationError("Microsoft did not return an access token")
        if not isinstance(refresh_token, str):
            refresh_token = fallback_refresh_token
        if not refresh_token:
            raise AuthenticationError("Microsoft did not return a refresh token")
        if not isinstance(expires_in, (int, float)):
            expires_in = 3600
        self._tokens = TokenSet(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=datetime.now(UTC) + timedelta(seconds=max(0, int(expires_in))),
        )
        # 刷新令牌可能在每次刷新时轮换，必须立即替换磁盘中的旧值。
        if persist:
            self._save_state()

    def _require_client_id(self) -> str:
        if not self.configured or self._client_id is None:
            raise ValidationError("Configure the OneDrive App ID first")
        return self._client_id

    def _purge_expired_states(self) -> None:
        now = datetime.now(UTC)
        self._pending = {
            state: pending
            for state, pending in self._pending.items()
            if pending.expires_at > now
        }

    def _load_credentials(self) -> None:
        payload = self._initial_state
        client_id = payload.get("client_id")
        if isinstance(client_id, str) and client_id:
            self._client_id = client_id
        refresh_token = payload.get("refresh_token")
        if isinstance(refresh_token, str) and refresh_token and self._client_id:
            # 访问令牌不落盘；以过期占位值触发首次请求时刷新。
            self._tokens = TokenSet(
                access_token="",
                refresh_token=refresh_token,
                expires_at=datetime.now(UTC),
            )
            self._account_id = payload["account_id"]
            display_name = payload.get("account_display_name")
            email = payload.get("account_email")
            self._account_display_name = (
                display_name if isinstance(display_name, str) else None
            )
            self._account_email = email if isinstance(email, str) else None

    def _save_state(self) -> None:
        if self._client_id is None:
            return
        payload = {"client_id": self._client_id}
        if self._tokens is not None and self._tokens.refresh_token:
            payload["refresh_token"] = self._tokens.refresh_token
        if self._account_id:
            payload["account_id"] = self._account_id
        if self._account_display_name:
            payload["account_display_name"] = self._account_display_name
        if self._account_email:
            payload["account_email"] = self._account_email
        self._persist_payload(payload)

    def _persist_payload(self, payload: dict[str, str]) -> None:
        try:
            self._persist(payload)
        except ProviderError:
            # Restore the last committed authorization after an atomic persistence failure.
            self._tokens = None
            self._client_id = None
            self._account_id = None
            self._account_display_name = None
            self._account_email = None
            self._pending.clear()
            self._generation += 1
            self._load_credentials()
            raise
        self._initial_state = payload.copy()
