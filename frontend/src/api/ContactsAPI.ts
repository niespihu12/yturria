import api from '@/lib/axios'
import { isAxiosError } from 'axios'

export type Contact = {
  id: string
  user_id: string
  name: string
  last_name: string
  specialty: string
  phone: string
  email: string
  whatsapp: string
  active: boolean
  created_at: string
  updated_at: string
}

export type ContactPayload = {
  name: string
  last_name?: string
  specialty?: string
  phone?: string
  email?: string
  whatsapp?: string
  active?: boolean
  user_id?: string
}

function getError(error: unknown): string {
  if (isAxiosError(error) && error.response) {
    const detail = error.response.data?.detail
    if (typeof detail === 'string') return detail
    if (detail?.message) return detail.message
    return error.response.data?.error ?? 'Error al conectar'
  }
  return 'Error al conectar'
}

export async function getContacts(params?: { search?: string; specialty?: string; user_id?: string }): Promise<{ contacts: Contact[] }> {
  try {
    const { data } = await api.get('/contacts', { params })
    return {
      contacts: Array.isArray(data?.contacts) ? (data.contacts as Contact[]) : [],
    }
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function createContact(payload: ContactPayload): Promise<Contact> {
  try {
    const { data } = await api.post('/contacts', payload)
    return data as Contact
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function updateContact(id: string, payload: ContactPayload): Promise<Contact> {
  try {
    const { data } = await api.put(`/contacts/${id}`, payload)
    return data as Contact
  } catch (error) {
    throw new Error(getError(error))
  }
}

export async function deleteContact(id: string): Promise<{ deleted: boolean }> {
  try {
    const { data } = await api.delete(`/contacts/${id}`)
    return data as { deleted: boolean }
  } catch (error) {
    throw new Error(getError(error))
  }
}
