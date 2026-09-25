import { useCallback, useId, useMemo, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'react-toastify'
import { useForm } from 'react-hook-form'
import { MagnifyingGlassIcon, PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { getContacts, createContact, updateContact, deleteContact } from '@/api/ContactsAPI'
import type { Contact, ContactPayload } from '@/api/ContactsAPI'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import PageHeader from '@/components/ui/PageHeader'
import { useConfirm } from '@/components/ui/ConfirmDialog'
import { formatPhone, isSamePhone, phoneHref, pluralize, whatsappHref } from '@/lib/format'
import { cn } from '@/lib/utils'

type ContactForm = {
  name: string
  last_name: string
  specialty: string
  phone: string
  email: string
  whatsapp: string
}

const EMPTY_FORM: ContactForm = {
  name: '',
  last_name: '',
  specialty: '',
  phone: '',
  email: '',
  whatsapp: '',
}

const inputClass =
  'h-10 w-full rounded-lg border border-border-default bg-surface px-3 text-sm text-text-primary placeholder:text-text-muted transition-colors focus:border-primary-500'

const labelClass = 'mb-1.5 block text-sm font-medium text-text-primary'

const iconButtonClass =
  'inline-flex size-9 items-center justify-center rounded-lg text-text-tertiary transition-colors hover:bg-neutral-100 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500'

function fullNameOf(contact: Contact): string {
  return [contact.name, contact.last_name].filter(Boolean).join(' ').trim() || 'Sin nombre'
}

function PhoneLines({ contact }: { contact: Contact }) {
  const { phone, whatsapp } = contact

  if (!phone && !whatsapp) {
    return <span className="text-text-muted">Sin teléfono</span>
  }

  return (
    <div className="space-y-0.5">
      {phone ? (
        <a href={phoneHref(phone)} className="tabular-nums text-text-primary hover:text-text-link">
          {formatPhone(phone)}
        </a>
      ) : null}
      {whatsapp && isSamePhone(phone, whatsapp) ? (
        <p className="text-xs text-text-tertiary">También en WhatsApp</p>
      ) : whatsapp ? (
        <p className="text-xs text-text-tertiary">
          WhatsApp{' '}
          <a
            href={whatsappHref(whatsapp)}
            target="_blank"
            rel="noreferrer"
            className="tabular-nums text-text-secondary hover:text-text-link"
          >
            {formatPhone(whatsapp)}
          </a>
        </p>
      ) : null}
    </div>
  )
}

export default function ContactsView() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [specialtyFilter, setSpecialtyFilter] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingContact, setEditingContact] = useState<Contact | null>(null)
  const [confirm, confirmDialog] = useConfirm()
  const fieldId = useId()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['contacts', search, specialtyFilter],
    queryFn: () => getContacts({ search: search || undefined, specialty: specialtyFilter || undefined }),
    placeholderData: keepPreviousData,
  })

  const contacts = useMemo<Contact[]>(() => data?.contacts ?? [], [data])
  const hasFilters = Boolean(search || specialtyFilter)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ContactForm>({ defaultValues: EMPTY_FORM })

  // Estable: ui/Modal reinicia el foco si cambia la referencia de onClose.
  const closeModal = useCallback(() => {
    setShowModal(false)
    setEditingContact(null)
    reset(EMPTY_FORM)
  }, [reset])

  const createMutation = useMutation({
    mutationFn: createContact,
    onSuccess: () => {
      toast.success('Contacto creado')
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      closeModal()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ContactPayload }) => updateContact(id, payload),
    onSuccess: () => {
      toast.success('Contacto actualizado')
      queryClient.invalidateQueries({ queryKey: ['contacts'] })
      closeModal()
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
    reset(EMPTY_FORM)
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

  const requestDelete = async (contact: Contact) => {
    const fullName = fullNameOf(contact)
    const accepted = await confirm({
      title: 'Eliminar contacto',
      description: `Se quitará a ${fullName} del directorio y el agente de voz dejará de transferirle llamadas.`,
      confirmLabel: 'Eliminar contacto',
      tone: 'danger',
    })
    if (accepted) deleteMutation.mutate(contact.id)
  }

  const specialties = useMemo(() => {
    const set = new Set<string>()
    contacts.forEach((c) => {
      if (c.specialty) set.add(c.specialty)
    })
    if (specialtyFilter) set.add(specialtyFilter)
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'))
  }, [contacts, specialtyFilter])

  const clearFilters = () => {
    setSearch('')
    setSpecialtyFilter('')
  }

  const isSaving = createMutation.isPending || updateMutation.isPending

  const renderActions = (contact: Contact, sizeClass = '') => {
    const fullName = fullNameOf(contact)
    return (
      <>
        <button
          type="button"
          onClick={() => openEdit(contact)}
          className={cn(iconButtonClass, sizeClass)}
          title="Editar"
          aria-label={`Editar a ${fullName}`}
        >
          <PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => requestDelete(contact)}
          disabled={deleteMutation.isPending && deleteMutation.variables === contact.id}
          className={cn(iconButtonClass, sizeClass, 'hover:bg-danger-50 hover:text-danger-700 disabled:opacity-50')}
          title="Eliminar"
          aria-label={`Eliminar a ${fullName} del directorio`}
        >
          <TrashIcon className="h-4 w-4" aria-hidden="true" />
        </button>
      </>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="@container mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
        <PageHeader
          title="Directorio de asesores"
          description="Personas a las que el agente de voz puede transferir una llamada cuando el cliente necesita a alguien de una especialidad."
          actions={
            <Button onClick={openCreate} leftIcon={<PlusIcon className="h-4 w-4" aria-hidden="true" />}>
              Nuevo contacto
            </Button>
          }
        />

        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <label htmlFor={`${fieldId}-search`} className="sr-only">
              Buscar asesor
            </label>
            <MagnifyingGlassIcon
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
              aria-hidden="true"
            />
            <input
              id={`${fieldId}-search`}
              type="search"
              placeholder="Buscar por nombre, apellido o especialidad"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${inputClass} pl-9`}
            />
          </div>
          <label htmlFor={`${fieldId}-specialty-filter`} className="sr-only">
            Filtrar por especialidad
          </label>
          <select
            id={`${fieldId}-specialty-filter`}
            value={specialtyFilter}
            onChange={(e) => setSpecialtyFilter(e.target.value)}
            className={`${inputClass} sm:w-60`}
          >
            <option value="">Todas las especialidades</option>
            {specialties.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {!isLoading && !isError && contacts.length > 0 && (
            <p className="shrink-0 text-sm text-text-tertiary tabular-nums sm:ml-2" aria-live="polite">
              {pluralize(contacts.length, 'asesor', 'asesores')}
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="rounded-xl border border-border-default bg-surface px-6 py-12 text-center text-sm text-text-tertiary">
            Cargando el directorio…
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-border-default bg-surface px-6 py-12 text-center">
            <p className="text-sm font-medium text-text-primary">No pudimos cargar el directorio.</p>
            <p className="mt-1 text-sm text-text-tertiary">Revise su conexión y vuelva a intentarlo en unos segundos.</p>
          </div>
        ) : contacts.length === 0 ? (
          <div className="rounded-xl border border-border-default bg-surface px-6 py-12 text-center">
            {hasFilters ? (
              <>
                <p className="text-sm font-medium text-text-primary">No hay asesores que coincidan con la búsqueda.</p>
                <Button variant="ghost" size="sm" className="mt-3" onClick={clearFilters}>
                  Quitar filtros
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-text-primary">Aún no hay asesores en el directorio.</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-text-tertiary">
                  Agregue a las personas del equipo con su especialidad y su número para que el agente de voz sepa a
                  quién transferir cada llamada.
                </p>
              </>
            )}
          </div>
        ) : (
          <section
            aria-label="Asesores del directorio"
            className="overflow-hidden rounded-xl border border-border-default bg-surface"
          >
            <table className="hidden w-full text-left text-sm @2xl:table">
              <thead className="border-b border-border-default bg-surface-muted">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium text-text-secondary">
                    Asesor
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium text-text-secondary">
                    Especialidad
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium text-text-secondary">
                    Teléfono y WhatsApp
                  </th>
                  <th scope="col" className="w-24 px-3 py-3">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {contacts.map((contact) => (
                  <tr key={contact.id} className="transition-colors hover:bg-surface-muted">
                    <td className="max-w-72 px-5 py-3.5 align-top">
                      <p className="font-medium text-text-primary">{fullNameOf(contact)}</p>
                      {contact.email ? (
                        <a
                          href={`mailto:${contact.email}`}
                          className="mt-0.5 block truncate text-text-tertiary hover:text-text-link"
                        >
                          {contact.email}
                        </a>
                      ) : null}
                    </td>
                    <td className="px-5 py-3.5 align-top text-text-secondary">
                      {contact.specialty || <span className="text-text-muted">Sin especialidad</span>}
                    </td>
                    <td className="px-5 py-3.5 align-top">
                      <PhoneLines contact={contact} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right align-top">
                      <div className="inline-flex gap-1">{renderActions(contact)}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="divide-y divide-border-subtle @2xl:hidden">
              {contacts.map((contact) => (
                <li key={contact.id} className="flex items-start gap-3 px-4 py-4">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium text-text-primary">{fullNameOf(contact)}</p>
                    <p className="mt-0.5 text-text-secondary">
                      {contact.specialty || <span className="text-text-muted">Sin especialidad</span>}
                    </p>
                    <div className="mt-2 space-y-1">
                      <PhoneLines contact={contact} />
                      {contact.email ? (
                        <a
                          href={`mailto:${contact.email}`}
                          className="block truncate text-text-tertiary hover:text-text-link"
                        >
                          {contact.email}
                        </a>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">{renderActions(contact, 'size-10')}</div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <Modal
        open={showModal}
        onClose={closeModal}
        title={editingContact ? 'Editar contacto' : 'Nuevo contacto'}
        description={
          editingContact
            ? undefined
            : 'El agente de voz podrá transferir llamadas a esta persona cuando el cliente pida su especialidad.'
        }
        dismissOnBackdrop={false}
      >
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${fieldId}-name`} className={labelClass}>
                Nombre
              </label>
              <input
                id={`${fieldId}-name`}
                {...register('name', {
                  validate: (value) => value.trim().length > 0 || 'Escriba el nombre del asesor.',
                })}
                aria-required="true"
                aria-invalid={errors.name ? 'true' : undefined}
                aria-describedby={errors.name ? `${fieldId}-name-error` : undefined}
                className={inputClass}
                placeholder="Ej.: Diana"
                autoComplete="off"
              />
              {errors.name && (
                <p id={`${fieldId}-name-error`} className="mt-1 text-sm text-danger-700">
                  {errors.name.message}
                </p>
              )}
            </div>
            <div>
              <label htmlFor={`${fieldId}-last-name`} className={labelClass}>
                Apellido
              </label>
              <input
                id={`${fieldId}-last-name`}
                {...register('last_name')}
                className={inputClass}
                placeholder="Ej.: Morales"
                autoComplete="off"
              />
            </div>
          </div>

          <div>
            <label htmlFor={`${fieldId}-specialty`} className={labelClass}>
              Especialidad
            </label>
            <input
              id={`${fieldId}-specialty`}
              {...register('specialty')}
              aria-describedby={`${fieldId}-specialty-help`}
              className={inputClass}
              placeholder="Ej.: Seguros de autos"
              autoComplete="off"
            />
            <p id={`${fieldId}-specialty-help`} className="mt-1 text-xs text-text-tertiary">
              El agente usa este dato para elegir a quién transferir.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${fieldId}-phone`} className={labelClass}>
                Teléfono
              </label>
              <input
                id={`${fieldId}-phone`}
                type="tel"
                {...register('phone')}
                className={`${inputClass} tabular-nums`}
                placeholder="+57 300 123 4567"
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor={`${fieldId}-whatsapp`} className={labelClass}>
                WhatsApp
              </label>
              <input
                id={`${fieldId}-whatsapp`}
                type="tel"
                {...register('whatsapp')}
                className={`${inputClass} tabular-nums`}
                placeholder="+57 300 123 4567"
                autoComplete="off"
              />
            </div>
          </div>

          <div>
            <label htmlFor={`${fieldId}-email`} className={labelClass}>
              Correo electrónico
            </label>
            <input
              id={`${fieldId}-email`}
              type="email"
              {...register('email')}
              className={inputClass}
              placeholder="nombre@empresa.com"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col-reverse gap-2 border-t border-border-subtle pt-4 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={closeModal}>
              Cancelar
            </Button>
            <Button type="submit" isLoading={isSaving}>
              {editingContact ? 'Guardar cambios' : 'Crear contacto'}
            </Button>
          </div>
        </form>
      </Modal>

      {confirmDialog}
    </div>
  )
}
