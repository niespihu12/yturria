from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from app.controllers.AuthController import AuthController
from app.schemas.auth import AdminUsersResponse, AuthenticatedUserResponse, MfaChallengeResponse

auth_router = APIRouter(prefix="/auth", tags=["Auth"])

auth_router.post("/create-account", response_class=PlainTextResponse)(
    AuthController.create_account
)
auth_router.post("/confirm-account", response_class=PlainTextResponse)(
    AuthController.confirm_account
)
auth_router.post("/login", responses={200: {"model": MfaChallengeResponse}})(
    AuthController.login
)
auth_router.post("/login/mfa", response_class=PlainTextResponse)(
    AuthController.login_with_mfa
)
auth_router.post("/request-code", response_class=PlainTextResponse)(
    AuthController.request_confirmation_code
)
auth_router.post("/forgot-password", response_class=PlainTextResponse)(
    AuthController.forgot_password
)
auth_router.post("/validate-token", response_class=PlainTextResponse)(
    AuthController.validate_token
)
auth_router.post("/update-password/{token}", response_class=PlainTextResponse)(
    AuthController.update_password_with_token
)
auth_router.get("/user", response_model=AuthenticatedUserResponse)(AuthController.user)
auth_router.put("/profile", response_class=PlainTextResponse)(
    AuthController.update_profile
)
auth_router.post("/update-password", response_class=PlainTextResponse)(
    AuthController.update_current_user_password
)
auth_router.post("/check-password", response_class=PlainTextResponse)(
    AuthController.check_password
)
auth_router.post("/mfa/enable", response_class=PlainTextResponse)(AuthController.enable_mfa)
auth_router.post("/mfa/disable", response_class=PlainTextResponse)(AuthController.disable_mfa)
auth_router.get("/admin/users", response_model=AdminUsersResponse)(AuthController.admin_users)
