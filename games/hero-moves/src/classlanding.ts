import './ui/toybox.css'
import './ui/classlanding.css'

/**
 * Hero Class landing page: the reservation sheet. A mockup — it validates and
 * thanks the parent, and sends nothing anywhere. Taking a deposit is a Lemon
 * Squeezy fixed product away (see the research report's 1-day prototype).
 */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const sheet = $('sheet'), form = $<HTMLFormElement>('form'), done = $('done'), error = $('error')

function open() {
  sheet.hidden = false
  form.hidden = false
  done.hidden = true
  error.textContent = ''
  document.documentElement.classList.add('cl-locked')
  $<HTMLInputElement>('f-gan').focus({ preventScroll: true })
}
function close() {
  sheet.hidden = true
  document.documentElement.classList.remove('cl-locked')
  $('reserve').focus({ preventScroll: true })
}

$('reserve').addEventListener('click', open)
$('close').addEventListener('click', close)
$('done-close').addEventListener('click', close)
sheet.addEventListener('click', (e) => { if (e.target === sheet) close() })
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) close() })

form.addEventListener('submit', (e) => {
  e.preventDefault()
  const missing = [...form.querySelectorAll<HTMLInputElement>('input[required]')].find((i) => !i.value.trim())
  if (missing) {
    error.textContent = 'חסר עוד פרט אחד'
    missing.focus()
    return
  }
  form.hidden = true
  done.hidden = false
})

// ?sheet=1 opens straight on the form (for screenshots).
const q = new URLSearchParams(location.search).get('sheet')
if (q === '1') open()
if (q === 'done') { open(); form.hidden = true; done.hidden = false }
