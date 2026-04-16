import secrets
import string


def generate_token(length: int = 6) -> str:
    return "".join(secrets.choice(string.digits) for _ in range(length))
