// Antes de salvar um cadastro, avisa quais campos ficaram em branco e pergunta
// se é para deixar assim mesmo (evita cadastro incompleto por esquecimento).
export function confirmarEmBranco(campos: { label: string; valor: unknown }[]): boolean {
  const vazios = campos.filter((c) => c.valor == null || String(c.valor).trim() === '').map((c) => c.label)
  if (vazios.length === 0) return true
  return window.confirm(
    `Estes campos estão em branco:\n\n• ${vazios.join('\n• ')}\n\nDeixar em branco mesmo?\n(OK = salvar assim · Cancelar = voltar e preencher)`,
  )
}
