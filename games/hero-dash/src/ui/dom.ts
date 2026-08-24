type Props<K extends keyof HTMLElementTagNameMap> =
  Omit<Partial<HTMLElementTagNameMap[K]>, 'style'> & { class?: string; style?: string }

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> = {} as Props<K>,
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v as string
    else if (k === 'style') node.setAttribute('style', v as string)
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v as any)
    else (node as any)[k] = v
  }
  for (const c of children) node.append(c as any)
  return node
}

export const fmt = (n: number) => Math.floor(n).toLocaleString('en-US')
