import { brand } from '@/brand'

type Props = {
  className?: string
  /** `mark` usa el isotipo cuadrado para espacios reducidos. */
  variant?: 'full' | 'mark'
}

export default function Logo({ className = 'mx-auto h-20 w-auto', variant = 'full' }: Props) {
  const asset = variant === 'mark' ? brand.mark : brand.logo
  // width/height reservan la proporción y evitan saltos de layout al cargar.
  return (
    <img src={asset.src} alt={asset.alt} width={asset.width} height={asset.height} className={className} />
  )
}
