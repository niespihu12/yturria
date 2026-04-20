import { useQuery } from '@tanstack/react-query'
import { getAuthenticatedUser } from '@/api/AuthAPI'

export function useCurrentUser() {
  const query = useQuery({
    queryKey: ['auth-user'],
    queryFn: getAuthenticatedUser,
    staleTime: 60_000,
  })

  const user = query.data
  const isSuperAdmin = user?.role === 'super_admin'
  const isClient = !!user && !isSuperAdmin

  return {
    user,
    isSuperAdmin,
    isClient,
    isLoading: query.isLoading,
  }
}
