/**
 * Utilidades criptográficas y de sesión para Cloudflare Pages Functions
 * Algoritmos basados en el estándar Web Crypto API nativo de Cloudflare Workers.
 */

// Codificación Base64 URL-Safe sin padding
export function base64UrlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// Decodificación Base64 URL-Safe
export function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Valida la autenticidad criptográfica de `initData` de Telegram Mini App
 * Documentación oficial: https://core.telegram.org/bots/webapps#validating-data-received-via-the-web-app
 */
export async function verifyTelegramInitData(initDataString, botToken, maxAgeSeconds = 86400) {
  if (!initDataString || !botToken) {
    return { isValid: false, reason: 'MISSING_DATA_OR_TOKEN' };
  }

  try {
    const params = new URLSearchParams(initDataString);
    const hash = params.get('hash');
    if (!hash) {
      return { isValid: false, reason: 'MISSING_HASH' };
    }

    // 1. Validar ventana temporal (anti-replay attack)
    const authDateStr = params.get('auth_date');
    if (!authDateStr) {
      return { isValid: false, reason: 'MISSING_AUTH_DATE' };
    }

    const authDate = parseInt(authDateStr, 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > maxAgeSeconds) {
      return { isValid: false, reason: 'TOKEN_EXPIRED', age: now - authDate };
    }

    // 2. Construir data_check_string ordenado alfabéticamente excluyendo 'hash'
    params.delete('hash');
    const sortedKeys = Array.from(params.keys()).sort();
    const dataCheckString = sortedKeys.map(key => `${key}=${params.get(key)}`).join('\n');

    // 3. Derivar secret_key = HMAC-SHA-256("WebAppData", botToken)
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const secretKeyBytes = await crypto.subtle.sign('HMAC', keyMaterial, enc.encode(botToken));

    // 4. Calcular HMAC-SHA-256(secret_key, data_check_string)
    const secretKey = await crypto.subtle.importKey(
      'raw',
      secretKeyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const calculatedSigBytes = await crypto.subtle.sign('HMAC', secretKey, enc.encode(dataCheckString));
    const calculatedHash = Array.from(new Uint8Array(calculatedSigBytes))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // 5. Comparación segura
    if (calculatedHash.toLowerCase() !== hash.toLowerCase()) {
      return { isValid: false, reason: 'INVALID_SIGNATURE' };
    }

    // Extraer datos del usuario
    const userRaw = params.get('user');
    const user = userRaw ? JSON.parse(userRaw) : null;

    return {
      isValid: true,
      user,
      authDate,
      queryId: params.get('query_id')
    };

  } catch (err) {
    return { isValid: false, reason: 'PARSE_EXCEPTION', error: err.message };
  }
}

/**
 * Emite un JSON Web Token (JWT) firmado con HS256
 */
export async function signJWT(payload, secretKeyStr) {
  const enc = new TextEncoder();
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretKeyStr),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(signingInput));
  let binary = '';
  const bytes = new Uint8Array(sigBytes);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const encodedSig = btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${signingInput}.${encodedSig}`;
}

/**
 * Verifica un JSON Web Token (JWT) firmado con HS256
 */
export async function verifyJWT(token, secretKeyStr) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSig] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secretKeyStr),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    // Reconstruir firma binaria
    let sigBase64 = encodedSig.replace(/-/g, '+').replace(/_/g, '/');
    while (sigBase64.length % 4) sigBase64 += '=';
    const binary = atob(sigBase64);
    const sigBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      sigBytes[i] = binary.charCodeAt(i);
    }

    const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(signingInput));
    if (!isValid) return null;

    const payload = JSON.parse(base64UrlDecode(encodedPayload));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null; // Expirado
    }

    return payload;
  } catch (err) {
    return null;
  }
}
