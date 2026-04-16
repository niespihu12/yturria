import api from "@/lib/axios";
import { isAxiosError } from "axios";
import {
    type AuthenticatedUser,
    mfaChallengeSchema,
    type ConfirmToken,
    type ForgotPasswordForm,
    type MfaChallenge,
    type MfaLoginForm,
    type MfaToggleForm,
    type NewPasswordForm,
    type RequestConfirmationCodeForm,
    type UpdateCurrentUserPasswordForm,
    type UserLoginForm,
    type UserProfileForm,
    type UserRegistrationForm,
} from "../types";


function getApiErrorMessage(error: unknown) {
    if (isAxiosError(error) && error.response) {
        const detail = error.response.data?.detail
        if (typeof detail === 'string') {
            return detail
        }

        if (detail?.message) {
            return detail.message
        }

        return error.response.data?.error ?? "Hubo un error"
    }

    return "Hubo un error"
}

export async function createAccount(formData: UserRegistrationForm) {
    try {
        const { data } = await api.post<string>('/auth/create-account', formData)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error))
    }
}

export async function confirmAccount(formData: ConfirmToken) {
    try {
        const { data } = await api.post<string>('/auth/confirm-account', formData)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error))
    }
}

export async function requestConfirmationCode(formData: RequestConfirmationCodeForm) {
    try {
        const { data } = await api.post<string>('/auth/request-code', formData)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error))
    }
}

export async function authenticateUser(formData: UserLoginForm): Promise<string | MfaChallenge> {
    try {
        const { data } = await api.post<string | MfaChallenge>('/auth/login', formData)
        const mfaChallenge = mfaChallengeSchema.safeParse(data)
        if (mfaChallenge.success) {
            return mfaChallenge.data
        }

        if (typeof data === 'string') {
            localStorage.setItem('AUTH_TOKEN', data)
            return data
        }

        throw new Error('Respuesta de login invalida')
    } catch (error) {
        throw new Error(getApiErrorMessage(error))
    }
}

export async function verifyMfaLogin(formData: MfaLoginForm) {
    try {
        const { data } = await api.post<string>('/auth/login/mfa', formData)
        localStorage.setItem('AUTH_TOKEN', data)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error))
    }
}

export async function forgotPasword(formData: ForgotPasswordForm) {
    try {
        const { data } = await api.post<string>('/auth/forgot-password', formData)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error))
    }
}

export async function validateToken(formData: ConfirmToken) {
    try {
        const { data } = await api.post<string>('/auth/validate-token', formData)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error))
    }
}

export async function updatePasswordWithToken({ formData, token }: { formData: NewPasswordForm, token: ConfirmToken['token'] }) {
    try {
        const { data } = await api.post<string>(`/auth/update-password/${token}`, formData)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error))
    }
}

export async function getAuthenticatedUser() {
    try {
        const { data } = await api.get<AuthenticatedUser>('/auth/user')
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error))
    }
}

export async function updateProfile(formData: UserProfileForm) {
    try {
        const { data } = await api.put<string>('/auth/profile', formData)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error))
    }
}

export async function updateCurrentUserPassword(formData: UpdateCurrentUserPasswordForm) {
    try {
        const { data } = await api.post<string>('/auth/update-password', formData)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error))
    }
}

export async function enableMfa(formData: MfaToggleForm) {
    try {
        const { data } = await api.post<string>('/auth/mfa/enable', formData)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error))
    }
}

export async function disableMfa(formData: MfaToggleForm) {
    try {
        const { data } = await api.post<string>('/auth/mfa/disable', formData)
        return data
    } catch (error) {
        throw new Error(getApiErrorMessage(error))
    }
}
