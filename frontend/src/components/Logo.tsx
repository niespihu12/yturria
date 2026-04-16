type Props = {
  className?: string
}

export default function Logo({ className = 'mx-auto h-20 w-auto' }: Props) {
  return (
    <img src="/logo.png" alt="Omnicanal" className={className} />
  )
}
