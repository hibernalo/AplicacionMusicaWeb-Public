/**
 * Script de migracion para el sistema de autenticacion
 *
 * Este script debe ejecutarse UNA SOLA VEZ despues de:
 * 1. Desplegar las nuevas reglas de Firestore
 * 2. Crear tu cuenta de administrador
 *
 * Funciones:
 * - Migrar likes globales (campo liked en songs) a la subcoleccion del admin
 * - Marcar playlists existentes como publicas (sin dueno)
 * - Marcar tu cuenta como admin
 */

import { db } from './firebase-config.js';
import authService from './auth-service.js';

class MigrationScript {
    constructor() {
        this.results = {
            likesCount: 0,
            playlistsCount: 0,
            errors: []
        };
    }

    /**
     * Ejecuta la migracion completa
     * Debe llamarse despues de que el admin inicie sesion
     */
    async runFullMigration() {
        const user = authService.getCurrentUser();
        if (!user) {
            console.error('Debes iniciar sesion primero');
            return null;
        }

        console.log('='.repeat(50));
        console.log('INICIANDO MIGRACION');
        console.log('Usuario:', user.email);
        console.log('='.repeat(50));

        try {
            // 1. Marcar usuario como admin
            await this.setUserAsAdmin(user.uid, user.email);

            // 2. Migrar likes globales
            await this.migrateGlobalLikes(user.uid);

            // 3. Marcar playlists como publicas
            await this.migratePlaylistsToPublic();

            console.log('='.repeat(50));
            console.log('MIGRACION COMPLETADA');
            console.log(`Likes migrados: ${this.results.likesCount}`);
            console.log(`Playlists actualizadas: ${this.results.playlistsCount}`);
            if (this.results.errors.length > 0) {
                console.log(`Errores: ${this.results.errors.length}`);
                this.results.errors.forEach(e => console.error(e));
            }
            console.log('='.repeat(50));

            return this.results;
        } catch (error) {
            console.error('Error en migracion:', error);
            this.results.errors.push(error.message);
            return this.results;
        }
    }

    /**
     * Marca un usuario como administrador
     */
    async setUserAsAdmin(userId, email) {
        console.log('\n[1/3] Configurando usuario como admin...');

        try {
            const userRef = db.collection('users').doc(userId);
            const userDoc = await userRef.get();

            if (userDoc.exists) {
                await userRef.update({ isAdmin: true });
            } else {
                await userRef.set({
                    email: email,
                    isAdmin: true,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
            }

            console.log(`Usuario ${email} marcado como admin`);
        } catch (error) {
            console.error('Error configurando admin:', error);
            this.results.errors.push(`Error admin: ${error.message}`);
        }
    }

    /**
     * Migra los likes globales (campo liked en songs) a la subcoleccion del usuario
     */
    async migrateGlobalLikes(userId) {
        console.log('\n[2/3] Migrando likes globales...');

        try {
            // Obtener todas las canciones con liked = true
            const likedSongsSnapshot = await db.collection('songs')
                .where('liked', '==', true)
                .get();

            if (likedSongsSnapshot.empty) {
                console.log('No hay likes globales para migrar');
                return;
            }

            console.log(`Encontradas ${likedSongsSnapshot.docs.length} canciones con liked=true`);

            // Crear likes en la subcoleccion del usuario
            const batch = db.batch();
            let count = 0;

            for (const songDoc of likedSongsSnapshot.docs) {
                const likeRef = db.collection('users').doc(userId)
                    .collection('likes').doc(songDoc.id);

                batch.set(likeRef, {
                    songId: songDoc.id,
                    likedAt: firebase.firestore.FieldValue.serverTimestamp(),
                    migratedFrom: 'global'
                });

                count++;

                // Firestore tiene limite de 500 operaciones por batch
                if (count % 450 === 0) {
                    await batch.commit();
                    console.log(`Procesados ${count} likes...`);
                }
            }

            // Commit final
            if (count % 450 !== 0) {
                await batch.commit();
            }

            this.results.likesCount = count;
            console.log(`Migrados ${count} likes al usuario ${userId}`);

        } catch (error) {
            console.error('Error migrando likes:', error);
            this.results.errors.push(`Error likes: ${error.message}`);
        }
    }

    /**
     * Marca las playlists existentes como publicas (sin dueno)
     */
    async migratePlaylistsToPublic() {
        console.log('\n[3/3] Actualizando playlists existentes...');

        try {
            const playlistsSnapshot = await db.collection('playlists').get();

            if (playlistsSnapshot.empty) {
                console.log('No hay playlists para actualizar');
                return;
            }

            const batch = db.batch();
            let count = 0;

            for (const playlistDoc of playlistsSnapshot.docs) {
                const data = playlistDoc.data();

                // Solo actualizar si no tiene ownerId definido
                if (data.ownerId === undefined) {
                    batch.update(playlistDoc.ref, {
                        ownerId: null,
                        isPublic: true,
                        createdAt: data.createdAt || firebase.firestore.FieldValue.serverTimestamp()
                    });
                    count++;
                }
            }

            if (count > 0) {
                await batch.commit();
            }

            this.results.playlistsCount = count;
            console.log(`Actualizadas ${count} playlists como publicas`);

        } catch (error) {
            console.error('Error actualizando playlists:', error);
            this.results.errors.push(`Error playlists: ${error.message}`);
        }
    }
}

// Exportar para uso desde la consola del navegador
window.MigrationScript = MigrationScript;

// Funcion de ayuda para ejecutar desde la consola
window.runMigration = async function() {
    const migration = new MigrationScript();
    return await migration.runFullMigration();
};

console.log('='.repeat(50));
console.log('SCRIPT DE MIGRACION CARGADO');
console.log('');
console.log('Para ejecutar la migracion:');
console.log('1. Inicia sesion con tu cuenta de admin');
console.log('2. Abre la consola del navegador (F12)');
console.log('3. Ejecuta: await runMigration()');
console.log('='.repeat(50));

export default MigrationScript;
