// Servicio de autenticación con Firebase Auth
import { auth, db } from './firebase-config.js';

class AuthService {
    constructor() {
        this.currentUser = null;
        this.authStateCallbacks = [];
    }

    /**
     * Inicializa el listener de estado de autenticación
     */
    init() {
        auth.onAuthStateChanged(async (user) => {
            this.currentUser = user;

            if (user) {
                // Crear o actualizar documento del usuario en Firestore
                await this.ensureUserDocument(user);
            }

            // Notificar a todos los callbacks registrados
            this.authStateCallbacks.forEach(callback => callback(user));
        });
    }

    /**
     * Registra un callback para cambios en el estado de autenticación
     * @param {Function} callback - Función a llamar cuando cambie el estado
     */
    onAuthStateChanged(callback) {
        this.authStateCallbacks.push(callback);
        // Llamar inmediatamente con el estado actual
        if (this.currentUser !== undefined) {
            callback(this.currentUser);
        }
    }

    /**
     * Registra un nuevo usuario con email y contraseña
     * @param {string} email
     * @param {string} password
     * @returns {Promise<firebase.User>}
     */
    async signUp(email, password) {
        try {
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            return userCredential.user;
        } catch (error) {
            throw this.translateError(error);
        }
    }

    /**
     * Inicia sesión con email y contraseña
     * @param {string} email
     * @param {string} password
     * @returns {Promise<firebase.User>}
     */
    async signIn(email, password) {
        try {
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            return userCredential.user;
        } catch (error) {
            throw this.translateError(error);
        }
    }

    /**
     * Cierra la sesión del usuario actual
     */
    async signOut() {
        try {
            await auth.signOut();
        } catch (error) {
            throw this.translateError(error);
        }
    }

    /**
     * Obtiene el usuario actual
     * @returns {firebase.User|null}
     */
    getCurrentUser() {
        return this.currentUser;
    }

    /**
     * Obtiene el ID del usuario actual
     * @returns {string|null}
     */
    getCurrentUserId() {
        return this.currentUser ? this.currentUser.uid : null;
    }

    /**
     * Verifica si hay un usuario autenticado
     * @returns {boolean}
     */
    isAuthenticated() {
        return this.currentUser !== null;
    }

    /**
     * Crea o actualiza el documento del usuario en Firestore
     * @param {firebase.User} user
     */
    async ensureUserDocument(user) {
        const userRef = db.collection('users').doc(user.uid);
        const userDoc = await userRef.get();

        if (!userDoc.exists) {
            // Crear nuevo documento de usuario
            await userRef.set({
                email: user.email,
                displayName: user.displayName || user.email.split('@')[0],
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                isAdmin: false
            });
        }
    }

    /**
     * Verifica si el usuario actual es administrador
     * @returns {Promise<boolean>}
     */
    async isAdmin() {
        if (!this.currentUser) return false;

        const userDoc = await db.collection('users').doc(this.currentUser.uid).get();
        if (!userDoc.exists) return false;

        return userDoc.data().isAdmin === true;
    }

    /**
     * Traduce errores de Firebase a mensajes en español
     * @param {Error} error
     * @returns {Error}
     */
    translateError(error) {
        const errorMessages = {
            'auth/email-already-in-use': 'Este correo electrónico ya está registrado',
            'auth/invalid-email': 'El correo electrónico no es válido',
            'auth/operation-not-allowed': 'Operación no permitida',
            'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres',
            'auth/user-disabled': 'Esta cuenta ha sido deshabilitada',
            'auth/user-not-found': 'No existe una cuenta con este correo',
            'auth/wrong-password': 'Contraseña incorrecta',
            'auth/invalid-credential': 'Credenciales inválidas',
            'auth/too-many-requests': 'Demasiados intentos fallidos. Intenta más tarde',
            'auth/network-request-failed': 'Error de conexión. Verifica tu internet'
        };

        const message = errorMessages[error.code] || error.message;
        const translatedError = new Error(message);
        translatedError.code = error.code;
        return translatedError;
    }

    /**
     * Valida el formato del email
     * @param {string} email
     * @returns {boolean}
     */
    validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Valida la contraseña (mínimo 6 caracteres)
     * @param {string} password
     * @returns {boolean}
     */
    validatePassword(password) {
        return password && password.length >= 6;
    }
}

// Exportar instancia singleton
const authService = new AuthService();
export default authService;
