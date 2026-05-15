import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { useForm } from 'react-hook-form'
import {
  PlusIcon,
  TrashIcon,
  PencilSquareIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
  UserCircleIcon,
} from '@heroicons/react/24/outline'
import { getContacts, createContact, updateContact, deleteContact } from '@/api/ContactsAPI'
import type { Contact, ContactPayload } from '@/api/ContactsAPI'
import { useCurrentUser } from '@/hooks/useCurrentUser'

type ContactForm = {
  name: string
  last_name: string
  specialty: string
  phone: string
  email: string
  whatsapp: string
}

export default function ContactsView() {
  const queryClient = useQueryClient()
  const { isSuperAdmin } = useCurrentUser()
  const [search, setSearch] = useState('')
  const [specialtyFilter, setSpecialtyFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['contacts', search, specialtyFilter],
    queryFn: () => getContacts({ search: search || undefined, specialty: specialtyFilter || undefined }),
  })

  const contacts: Contact[] = data?.contacts ?? []

  const defaultValues = useMemo<ContactForm>(
    () => ({
      name: '',
      last_name: '',
      specialty: '',
      phone: '',
      email: '',
      whatsapp: '',
    }),
    []
  )

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactForm>({ defaultValues })

  const createMutation = useMutation({
    mutationFn: createContact,
    onSuccess: () => {
      toast.success('Contacto creado')
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      setShowModal(false)
      reset(defaultValues)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ContactPayload }) => updateContact(id, payload),
    onSuccess: () => {
      toast.success('Contacto actualizado')
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      setShowModal(false)
      setEditingContact(null)
      reset(defaultValues)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteContact,
    onSuccess: () => {
      toast.success('Contacto eliminado')
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const onSubmit = (form: ContactForm) => {
    const payload: ContactPayload = {
      name: form.name.trim(),
      last_name: form.last_name.trim(),
      specialty: form.specialty.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      whatsapp: form.whatsapp.trim(),
    }

    if (editingContact) {
      updateMutation.mutate({ id: editingContact.id, payload })
    } else {
      createMutation.mutate(payload)
    }
  }

  const openCreate = () => {
    setEditingContact(null)
    reset(defaultValues)
    setShowModal(true)
  }

  const openEdit = (contact: Contact) => {
    setEditingContact(contact)
    reset({
      name: contact.name,
      last_name: contact.last_name,
      specialty: contact.specialty,
      phone: contact.phone,
      email: contact.email,
      whatsapp: contact.whatsapp,
    })
    setShowModal(true)
  }

  const specialties = useMemo(() => {
    const set = new Set<string>()
    contacts.forEach((c) => {
      if (c.specialty) set.add(c.specialty)
    })
    return Array.from(set).sort()
  }, [contacts])

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[#271173]">Directorio de Asesores</h1>
            <p className="mt-1 text-sm text-black/50">
              Administra el catálogo de personas para redireccionamiento del agente de voz.
            </p>
          </div>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-[#271173] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#3a1d9e] transition-colors"
          >
            <PlusIcon className="h-4 w-4" />
            Nuevo contacto
          </button>
        </div>

        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <MagnifyingGlassIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/40" />
            <input
              type="text"
              placeholder="Buscar por nombre, apellido, especialidad..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-[#e4e0f5] bg-white py-2.5 pl-10 pr-4 text-sm outline-none focus:border-[#271173] focus:ring-1 focus:ring-[#271173]"
            />
          </div>
          <select
            value={specialtyFilter}
            onChange={(e) => setSpecialtyFilter(e.target.value)}
            className="rounded-xl border border-[#e4e0f5] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#271173] focus:ring-1 focus:ring-[#271173]"
          >
            <option value="">Todas las especialidades</option>
            {specialties.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="rounded-2xl border border-[#e4e0f5] bg-white p-12 text-center text-sm text-black/50">
            Cargando contactos...
          </div>
        ) : contacts.length === 0 ? (
          <div className="rounded-2xl border border-[#e4e0f5] bg-white p-12 text-center">
            <UserCircleIcon className="mx-auto h-12 w-12 text-black/20" />
            <p className="mt-3 text-sm font-medium text-black/60">No hay contactos</p>
            <p className="mt-1 text-xs text-black/40">
              Agrega asesores al directorio para que el agente de voz pueda redireccionar llamadas.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[#e4e0f5] bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f5f3ff]">
                <tr>
                  <th className="px-5 py-3 font-semibold text-[#271173]">Nombre</th>
                  <th className="px-5 py-3 font-semibold text-[#271173]">Especialidad</th>
                  <th className="px-5 py-3 font-semibold text-[#271173]">Teléfono</th>
                  <th className="px-5 py-3 font-semibold text-[#271173]">WhatsApp</th>
                  <th className="px-5 py-3 font-semibold text-[#271173]">Email</th>
                  <th className="px-5 py-3 text-right font-semibold text-[#271173]">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0eefb]">
                {contacts.map((contact) => (
                  <tr key={contact.id} className="hover:bg-[#faf9ff]">
                    <td className="px-5 py-3">
                      <div className="font-medium text-black/80">
                        {contact.name} {contact.last_name}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {contact.specialty ? (
                        <span className="inline-flex rounded-lg bg-[#f5f3ff] px-2.5 py-1 text-xs font-medium text-[#271173]">
                          {contact.specialty}
                        </span>
                      ) : (
                        <span className="text-xs text-black/30">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-black/60">{contact.phone || '—'}</td>
                    <td className="px-5 py-3 text-black/60">{contact.whatsapp || '—'}</td>
                    <td className="px-5 py-3 text-black/60">{contact.email || '—'}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <button
                          onClick={() => openEdit(contact)}
                          className="rounded-lg p-1.5 text-black/40 hover:bg-[#f5f3ff] hover:text-[#271173]"
                          title="Editar"
                        >
                          <PencilSquareIcon className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('¿Eliminar este contacto?')) {
                              deleteMutation.mutate(contact.id)
                            }
                          }}
                          className="rounded-lg p-1.5 text-black/40 hover:bg-rose-50 hover:text-rose-600"
                          title="Eliminar"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#271173]">
                {editingContact ? 'Editar contacto' : 'Nuevo contacto'}
              </h2>
              <button
                onClick={() => {
                  setShowModal(false)
                  setEditingContact(null)
                  reset(defaultValues)
                }}
                className="rounded-lg p-1 text-black/40 hover:bg-black/5"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-black/60">Nombre *</label>
                  <input
                    {...register('name', { required: 'El nombre es requerido' })}
                    className="w-full rounded-xl border border-[#e4e0f5] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#271173] focus:ring-1 focus:ring-[#271173]"
                    placeholder="Ej: Dorian"
                  />
                  {errors.name && (
                    <p className="mt-1 text-xs text-rose-500">{errors.name.message}</p>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-black/60">Apellido</label>
                  <input
                    {...register('last_name')}
                    className="w-full rounded-xl border border-[#e4e0f5] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#271173] focus:ring-1 focus:ring-[#271173]"
                    placeholder="Ej: Gomez"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-black/60">Especialidad</label>
                <input
                  {...register('specialty')}
                  className="w-full rounded-xl border border-[#e4e0f5] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#271173] focus:ring-1 focus:ring-[#271173]"
                  placeholder="Ej: Seguros de auto, Asesoría financiera"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-black/60">Teléfono</label>
                  <input
                    {...register('phone')}
                    className="w-full rounded-xl border border-[#e4e0f5] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#271173] focus:ring-1 focus:ring-[#271173]"
                    placeholder="+52 55 1234 5678"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-black/60">WhatsApp</label>
                  <input
                    {...register('whatsapp')}
                    className="w-full rounded-xl border border-[#e4e0f5] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#271173] focus:ring-1 focus:ring-[#271173]"
                    placeholder="+52 55 1234 5678"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-black/60">Email</label>
                <input
                  {...register('email')}
                  type="email"
                  className="w-full rounded-xl border border-[#e4e0f5] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#271173] focus:ring-1 focus:ring-[#271173]"
                  placeholder="correo@ejemplo.com"
                />
              </div>

              <div className="pt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    setEditingContact(null)
                    reset(defaultValues)
                  }}
                  className="rounded-xl border border-[#e4e0f5] px-4 py-2.5 text-sm font-medium text-black/60 hover:bg-[#f5f3ff]"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="rounded-xl bg-[#271173] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#3a1d9e] disabled:opacity-50"
                >
                  {editingContact ? 'Guardar cambios' : 'Crear contacto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
