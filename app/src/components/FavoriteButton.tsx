import { Star } from 'lucide-react'

/**
 * 生词标记按钮（五角星）。
 *
 * 学习模式和背诵模式都用它，保证行为一致：
 * 点击即收藏/取消，乐观更新由调用方负责。
 */
export default function FavoriteButton({ active, onToggle, size = 'md' }: {
  active: boolean
  onToggle: () => void
  size?: 'sm' | 'md'
}) {
  const box = size === 'sm' ? 'h-9 w-9' : 'h-11 w-11'
  const icon = size === 'sm' ? 18 : 20
  return <button
    type="button"
    aria-label={active ? '取消生词标记' : '标记为生词'}
    aria-pressed={active}
    onClick={(event) => { event.stopPropagation(); onToggle() }}
    className={`flex ${box} shrink-0 items-center justify-center rounded-full transition-colors ${active ? 'bg-amber-100 text-amber-600' : 'bg-stone-100 text-stone-400 hover:bg-stone-200'}`}
  >
    <Star size={icon} fill={active ? 'currentColor' : 'none'} />
  </button>
}
