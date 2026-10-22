import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// Una sola contraseña (APP_PASSWORD) para entrar. La sesión es una cookie firmada con esa
// misma contraseña, así que cambiarla en Vercel cierra la sesión en todos los celulares.
const COOKIE = 'bugalucho_sesion';
const DURACION_DIAS = 90;

const clave = () => process.env.APP_PASSWORD ?? '';

export function authActiva() {
  // Sin contraseña solo se permite en el computador; en Vercel siempre se exige.
  return Boolean(clave()) || Boolean(process.env.VERCEL);
}

function firmar(texto) {
  return createHmac('sha256', `bugalucho:${clave()}`).update(texto).digest('base64url');
}

function iguales(a, b) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function leerCookie(req) {
  for (const parte of (req.headers.cookie ?? '').split(';')) {
    const [nombre, ...valor] = parte.trim().split('=');
    if (nombre === COOKIE) return valor.join('=');
  }
  return '';
}

export function sesionValida(req) {
  if (!authActiva()) return true;
  if (!clave()) return false;
  const [vence, firma] = leerCookie(req).split('.');
  if (!vence || !firma || Number(vence) < Date.now()) return false;
  return iguales(firma, firmar(vence));
}

export function contrasenaCorrecta(intento) {
  return Boolean(clave()) && iguales(String(intento ?? ''), clave());
}

function atributos(req, maxAge) {
  const segura = req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${segura}`;
}

export function cookieSesion(req) {
  const vence = String(Date.now() + DURACION_DIAS * 86400000);
  return `${COOKIE}=${vence}.${firmar(vence)}; ${atributos(req, DURACION_DIAS * 86400)}`;
}

export function cookieSalir(req) {
  return `${COOKIE}=; ${atributos(req, 0)}`;
}
