import { storage } from './firebase-config.js';

/**
 * Servicio para obtener URLs de archivos desde Firebase Storage
 */
class StorageService {
    constructor() {
        this.audioUrlCache = new Map();
        this.coverUrlCache = new Map();
    }

    /**
     * Obtiene la URL de descarga de un archivo de audio
     * @param {string} path - Ruta del archivo en Storage (ej: "Audios/01 ALIVE.mp3")
     * @returns {Promise<string>} URL del archivo
     */
    async getAudioUrl(path) {
        // Verificar caché
        if (this.audioUrlCache.has(path)) {
            return this.audioUrlCache.get(path);
        }

        try {
            const storageRef = storage.ref(path);
            const url = await storageRef.getDownloadURL();
            
            // Guardar en caché
            this.audioUrlCache.set(path, url);
            
            return url;
        } catch (error) {
            console.error(`Error obteniendo URL de audio ${path}:`, error);
            throw error;
        }
    }

    /**
     * Obtiene la URL de descarga de una imagen de cover
     * @param {string} path - Ruta del archivo en Storage (ej: "Covers/01 ALIVE.jpg")
     * @returns {Promise<string>} URL del archivo
     */
    async getCoverUrl(path) {
        // Verificar caché
        if (this.coverUrlCache.has(path)) {
            return this.coverUrlCache.get(path);
        }

        try {
            const storageRef = storage.ref(path);
            const url = await storageRef.getDownloadURL();
            
            // Guardar en caché
            this.coverUrlCache.set(path, url);
            
            return url;
        } catch (error) {
            console.error(`Error obteniendo URL de cover ${path}:`, error);
            // Retornar URL de placeholder si hay error
            return this.getPlaceholderCoverUrl();
        }
    }

    /**
     * Obtiene una URL de placeholder para covers que fallan al cargar
     * @returns {string} URL de placeholder
     */
    getPlaceholderCoverUrl() {
        // Retornar data URL de un placeholder simple
        return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjQwIiBoZWlnaHQ9IjY0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iNjQwIiBoZWlnaHQ9IjY0MCIgZmlsbD0iIzMzMzMzMyIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBmb250LWZhbWlseT0iQXJpYWwiIGZvbnQtc2l6ZT0iMjQiIGZpbGw9IiM2NjY2NjYiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIj5ObyBJbWFnZTwvdGV4dD48L3N2Zz4=';
    }

    /**
     * Limpia el caché de URLs
     */
    clearCache() {
        this.audioUrlCache.clear();
        this.coverUrlCache.clear();
    }

    /**
     * Sube una imagen a Firebase Storage
     * @param {File} file - Archivo de imagen a subir
     * @param {string} folder - Carpeta donde guardar (CoverArtistas, CoverGenres, CoverSources)
     * @param {string} fileName - Nombre del archivo (sin extensión)
     * @returns {Promise<string>} Ruta completa del archivo en Storage
     */
    async uploadImage(file, folder, fileName) {
        try {
            // Validar que sea una imagen
            if (!file.type.startsWith('image/')) {
                throw new Error('El archivo debe ser una imagen');
            }

            // Obtener la extensión del archivo original
            const fileExtension = file.name.split('.').pop().toLowerCase();
            
            // Crear nombre único con timestamp
            const timestamp = Date.now();
            const uniqueFileName = `${fileName}_${timestamp}.${fileExtension}`;
            
            // Construir la ruta completa
            const storagePath = `${folder}/${uniqueFileName}`;
            
            // Crear referencia al archivo
            const storageRef = storage.ref(storagePath);
            
            // Subir el archivo
            const snapshot = await storageRef.put(file);
            
            console.log(`Imagen subida exitosamente: ${storagePath}`);
            
            // Limpiar caché de covers para que se recargue
            this.coverUrlCache.clear();
            
            // Retornar la ruta completa
            return storagePath;
        } catch (error) {
            console.error(`Error subiendo imagen a ${folder}:`, error);
            throw error;
        }
    }

    /**
     * Elimina una imagen de Firebase Storage
     * @param {string} path - Ruta completa del archivo en Storage
     * @returns {Promise<void>}
     */
    async deleteImage(path) {
        try {
            if (!path || path.trim() === '') {
                return; // No hay nada que eliminar
            }

            const storageRef = storage.ref(path);
            await storageRef.delete();
            
            console.log(`Imagen eliminada exitosamente: ${path}`);
            
            // Limpiar caché
            this.coverUrlCache.delete(path);
        } catch (error) {
            // Si el archivo no existe, no es un error crítico
            if (error.code === 'storage/object-not-found') {
                console.log(`Imagen no encontrada para eliminar: ${path}`);
                return;
            }
            console.error(`Error eliminando imagen ${path}:`, error);
            throw error;
        }
    }
}

// Crear instancia singleton
const storageService = new StorageService();

export default storageService;
