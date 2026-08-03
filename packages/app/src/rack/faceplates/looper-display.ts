export function loopTime(seconds: number): string {
  if (!(seconds > 0)) return 'EMPTY'
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`
}
