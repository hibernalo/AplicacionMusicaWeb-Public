// Servicio de likes por usuario
import { db } from './firebase-config.js';

class UserLikesService {
    constructor() {
        this.userId = null;
        this.likesCache = new Set(); // Cache local de IDs de canciones liked
        this.isLoaded = false;
        this.unsubscribe = null; // Para detener el listener en tiempo real
    }

    /**
     * Establece el ID del usuario actual
     * @param {string|null} userId
     */
    setUserId(userId) {
        // Si cambia el usuario, limpiar cache y detener listener anterior
        if (this.userId !== userId) {
            this.clearCache();
            if (this.unsubscribe) {
                this.unsubscribe();
                this.unsubscribe = null;
            }
        }

        this.userId = userId;

        if (userId) {
            this.loadUserLikes();
        }
    }

    /**
     * Obtiene el ID del usuario actual
     * @returns {string|null}
     */
    getCurrentUserId() {
        return this.userId;
    }

    /**
     * Carga los likes del usuario actual y establece listener en tiempo real
     */
    async loadUserLikes() {
        if (!this.userId) {
            this.likesCache.clear();
            this.isLoaded = false;
            return;
        }

        try {
            // Cargar likes iniciales
            const likesRef = db.collection('users').doc(this.userId).collection('likes');
            const snapshot = await likesRef.get();

            this.likesCache.clear();
            snapshot.docs.forEach(doc => {
                this.likesCache.add(doc.id);
            });

            this.isLoaded = true;
            console.log(`UserLikesService: Cargados ${this.likesCache.size} likes para usuario ${this.userId}`);

            // Establecer listener en tiempo real para cambios
            this.unsubscribe = likesRef.onSnapshot((snapshot) => {
                this.likesCache.clear();
                snapshot.docs.forEach(doc => {
                    this.likesCache.add(doc.id);
                });
                console.log(`UserLikesService: Cache actualizado con ${this.likesCache.size} likes`);
            });

        } catch (error) {
            console.error('Error cargando likes del usuario:', error);
            this.likesCache.clear();
            this.isLoaded = false;
        }
    }

    /**
     * Verifica si una cancion esta marcada como liked
     * @param {string} songId
     * @returns {boolean}
     */
    isLiked(songId) {
        if (!this.userId || !songId) return false;
        return this.likesCache.has(songId);
    }

    /**
     * Agrega una cancion a los likes del usuario
     * @param {string} songId
     */
    async addLike(songId) {
        if (!this.userId || !songId) {
            throw new Error('Usuario no autenticado');
        }

        try {
            await db.collection('users').doc(this.userId)
                .collection('likes').doc(songId)
                .set({
                    songId: songId,
                    likedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

            this.likesCache.add(songId);
            console.log(`Like agregado: ${songId}`);
        } catch (error) {
            console.error('Error agregando like:', error);
            throw error;
        }
    }

    /**
     * Elimina una cancion de los likes del usuario
     * @param {string} songId
     */
    async removeLike(songId) {
        if (!this.userId || !songId) {
            throw new Error('Usuario no autenticado');
        }

        try {
            await db.collection('users').doc(this.userId)
                .collection('likes').doc(songId)
                .delete();

            this.likesCache.delete(songId);
            console.log(`Like eliminado: ${songId}`);
        } catch (error) {
            console.error('Error eliminando like:', error);
            throw error;
        }
    }

    /**
     * Alterna el estado de like de una cancion
     * @param {string} songId
     * @returns {boolean} Nuevo estado de like
     */
    async toggleLike(songId) {
        if (this.isLiked(songId)) {
            await this.removeLike(songId);
            return false;
        } else {
            await this.addLike(songId);
            return true;
        }
    }

    /**
     * Obtiene todos los IDs de canciones liked del usuario
     * @returns {string[]}
     */
    getLikedSongIds() {
        return Array.from(this.likesCache);
    }

    /**
     * Obtiene el numero de likes del usuario
     * @returns {number}
     */
    getLikesCount() {
        return this.likesCache.size;
    }

    /**
     * Limpia el cache de likes
     */
    clearCache() {
        this.likesCache.clear();
        this.isLoaded = false;
    }

    /**
     * Migra los likes globales existentes al usuario actual (solo para admin)
     * @returns {Promise<number>} Numero de likes migrados
     */
    async migrateGlobalLikes() {
        if (!this.userId) {
            throw new Error('Usuario no autenticado');
        }

        try {
            // Obtener todas las canciones con liked = true
            const likedSongsSnapshot = await db.collection('songs')
                .where('liked', '==', true)
                .get();

            if (likedSongsSnapshot.empty) {
                console.log('No hay likes globales para migrar');
                return 0;
            }

            const batch = db.batch();
            let count = 0;

            for (const songDoc of likedSongsSnapshot.docs) {
                const likeRef = db.collection('users').doc(this.userId)
                    .collection('likes').doc(songDoc.id);

                batch.set(likeRef, {
                    songId: songDoc.id,
                    likedAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                count++;
            }

            await batch.commit();
            console.log(`Migrados ${count} likes globales al usuario ${this.userId}`);

            // Recargar cache
            await this.loadUserLikes();

            return count;
        } catch (error) {
            console.error('Error migrando likes globales:', error);
            throw error;
        }
    }
}

// Exportar instancia singleton
const userLikesService = new UserLikesService();
export default userLikesService;
