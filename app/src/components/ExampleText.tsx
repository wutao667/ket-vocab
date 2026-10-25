import { splitExample } from './exampleHighlight'

export function ExampleText({ example, word, className = '', hitClassName = 'bg-transparent font-bold text-red-800' }: {
  example: string
  word: string
  className?: string
  hitClassName?: string
}) {
  const segments = splitExample(example, word)
  return <span className={className}>
    {segments.map((segment, index) => segment.hit
      ? <mark key={index} className={hitClassName}>{segment.text}</mark>
      : <span key={index}>{segment.text}</span>)}
  </span>
}
