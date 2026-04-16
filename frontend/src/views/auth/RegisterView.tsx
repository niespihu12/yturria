import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { useMutation } from '@tanstack/react-query'
import type { UserRegistrationForm } from "@/types/index";
import ErrorMessage from "@/components/ErrorMessage";
import { createAccount } from "@/api/AuthAPI";
import { toast } from "react-toastify";

const inputClass =
  "w-full rounded-xl border border-[#e4e0f5] bg-white px-4 py-2.5 text-sm text-black placeholder:text-black/40 transition-colors focus:border-[#271173] focus:outline-none"

const labelClass = "block text-sm font-medium text-black/80 mb-1.5"

export default function RegisterView() {
    const initialValues: UserRegistrationForm = {
        name: '',
        email: '',
        password: '',
        password_confirmation: '',
    }

    const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<UserRegistrationForm>({ defaultValues: initialValues });

    const { mutate, isPending } = useMutation({
        mutationFn: createAccount,
        onError: (error) => {
            toast.error(error.message)
        },
        onSuccess: (data) => {
            toast.success(data)
            reset()
        }
    })

    const handleRegister = (formData: UserRegistrationForm) => mutate(formData)

    return (
        <>
            <h1 className="text-3xl font-bold text-black text-center mt-8">Crear Cuenta</h1>
            <p className="text-center text-sm text-black/50 mt-1.5">Ingresa tus datos para registrarte</p>

            <form
                onSubmit={handleSubmit(handleRegister)}
                className="mt-8 space-y-4 rounded-2xl border border-[#e4e0f5] bg-white p-8 shadow-sm"
                noValidate
            >
                <div>
                    <label className={labelClass} htmlFor="email">Email</label>
                    <input
                        id="email"
                        type="email"
                        placeholder="correo@empresa.com"
                        className={inputClass}
                        {...register("email", {
                            required: "El Email de registro es obligatorio",
                            pattern: {
                                value: /\S+@\S+\.\S+/,
                                message: "E-mail no válido",
                            },
                        })}
                    />
                    {errors.email && <ErrorMessage>{errors.email.message}</ErrorMessage>}
                </div>

                <div>
                    <label className={labelClass}>Nombre</label>
                    <input
                        type="text"
                        placeholder="Tu nombre completo"
                        className={inputClass}
                        {...register("name", {
                            required: "El Nombre de usuario es obligatorio",
                        })}
                    />
                    {errors.name && <ErrorMessage>{errors.name.message}</ErrorMessage>}
                </div>

                <div>
                    <label className={labelClass}>Password</label>
                    <input
                        type="password"
                        placeholder="Minimo 8 caracteres"
                        className={inputClass}
                        {...register("password", {
                            required: "El Password es obligatorio",
                            minLength: {
                                value: 8,
                                message: 'El Password debe ser mínimo de 8 caracteres'
                            }
                        })}
                    />
                    {errors.password && <ErrorMessage>{errors.password.message}</ErrorMessage>}
                </div>

                <div>
                    <label className={labelClass}>Repetir Password</label>
                    <input
                        id="password_confirmation"
                        type="password"
                        placeholder="Repite tu password"
                        className={inputClass}
                        {...register("password_confirmation", {
                            required: "Repetir Password es obligatorio",
                            validate: (value) => {
                                const password = watch("password");
                                return value === password || "Los Passwords no son iguales";
                            },
                        })}
                    />
                    {errors.password_confirmation && <ErrorMessage>{errors.password_confirmation.message}</ErrorMessage>}
                </div>

                <div className="pt-1">
                    <input
                        type="submit"
                        value={isPending ? 'Registrando...' : 'Registrarme'}
                        className="w-full cursor-pointer rounded-xl bg-[#271173] py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1f0d5a] disabled:opacity-60"
                        disabled={isPending}
                    />
                </div>
            </form>

            <nav className="mt-5 flex flex-col space-y-3">
                <Link
                    to="/auth/login"
                    className="text-center text-sm text-black/60 transition-colors hover:text-[#271173]"
                >
                    ¿Ya tienes cuenta? Iniciar Sesión
                </Link>
                <Link
                    to="/auth/forgot-password"
                    className="text-center text-sm text-black/60 transition-colors hover:text-[#271173]"
                >
                    ¿Olvidaste tu contraseña? Reestablecer
                </Link>
            </nav>
        </>
    )
}
