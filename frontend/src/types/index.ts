import { z } from 'zod'


/** Auth */
const authSchema = z.object({
    name: z.string(),
    email: z.string().email(),
    current_password: z.string(),
    password: z.string(),
    password_confirmation: z.string(),
    token: z.string(),
    code: z.string(),
    mfa_token: z.string()
})

type Auth = z.infer<typeof authSchema>

export type UserLoginForm = Pick<Auth, 'email' | 'password'>
export type UserRegistrationForm = Pick<Auth, 'name' | 'email' | 'password' | 'password_confirmation'>
export type UserProfileForm = Pick<Auth, 'name' | 'email'>
export type RequestConfirmationCodeForm = Pick<Auth, 'email'>
export type ForgotPasswordForm = Pick<Auth, 'email'>
export type NewPasswordForm = Pick<Auth, 'password' | 'password_confirmation'>
export type UpdateCurrentUserPasswordForm = Pick<Auth, 'current_password' | 'password' | 'password_confirmation'>
export type ConfirmToken = Pick<Auth, 'token'>
export type CheckPasswordForm = Pick<Auth, 'password'>
export type MfaLoginForm = Pick<Auth, 'mfa_token' | 'code'>
export type MfaToggleForm = Pick<Auth, 'current_password'>

export type AuthenticatedUser = {
    _id: string
    name: string
    email: string
    mfa_enabled: boolean
}


/** MFA */
export const mfaChallengeSchema = z.object({
    requires_mfa: z.literal(true),
    mfa_token: z.string(),
    message: z.string()
})

export type MfaChallenge = z.infer<typeof mfaChallengeSchema>
