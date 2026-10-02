/**
 * Utilidad de Compresión y Redimensionamiento de Imágenes en Cliente
 * Ruta: src/utils/imageCompressor.ts
 * 
 * Reduce imágenes de alta resolución (3-12 MB) capturadas por cámaras móviles a ~200-300 KB
 * manteniendo nitidez pericial completa de sellos, números y firmas para R2 y Notion.
 */

export async function compressImageFile(
  file: File | Blob,
  maxWidth = 1600,
  quality = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Si no estamos en un entorno con DOM (SSR / Node), devolver lectura directa
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (readerEvent) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Redimensionar proporcionalmente si supera el ancho máximo
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(readerEvent.target?.result as string);
          return;
        }

        // Suavizado de alta calidad para preservar tipografías y sellos
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // Fondo blanco para prevenir transparencias accidentales en PNGs convertidos a JPEG
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        ctx.drawImage(img, 0, 0, width, height);

        // Convertir a JPEG comprimido
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };

      img.onerror = () => {
        // Fallback a imagen original si falla el decodificador
        resolve(readerEvent.target?.result as string);
      };

      img.src = readerEvent.target?.result as string;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
