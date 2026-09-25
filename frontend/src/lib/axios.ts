import axios from "axios";
import { AUTH_TOKEN_KEY, clearSession } from "@/lib/session";

const api = axios.create({
    baseURL: import.meta.env.VITE_API_URL
})

api.interceptors.request.use( config => {
    const token = localStorage.getItem(AUTH_TOKEN_KEY)
    if(token){
        config.headers.Authorization = `Bearer ${token}`
    }
    return config
})

// An expired or revoked session sends the user back to login instead of
// leaving every view failing. Only the auth dependency marks its 401s with
// "WWW-Authenticate: Bearer"; a wrong current password or embed token does not.
api.interceptors.response.use(
    response => response,
    error => {
        const status = error?.response?.status
        const wwwAuthenticate = String(error?.response?.headers?.['www-authenticate'] ?? '')
        const sentToken = Boolean(error?.config?.headers?.Authorization)
        if (status === 401 && sentToken && wwwAuthenticate.toLowerCase().startsWith('bearer')) {
            clearSession()
            if (!window.location.pathname.startsWith('/auth/')) {
                window.location.assign('/auth/login')
            }
        }
        return Promise.reject(error)
    }
)

export default api
