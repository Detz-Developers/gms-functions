import { auth, db } from "../../support/firebase.js";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { set, get, ref, remove, update } from "firebase/database";

const notifRef = (uid: string, id: string) => ref(db, `notifications/${uid}/${id}`);
const userNotificationsRef = (uid: string) => ref(db, `notifications/${uid}`);

describe("Notification Functions", () => {
    const TEST_USER_EMAIL = "operator@gmail.com";
    const TEST_USER_PASSWORD = "Temp@123";
    let testUserId: string;

    // Helper function to create a test notification
    const createTestNotification = async (uid: string, read = false) => {
        const notifId = `test-notif-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const testNotif = {
            id: notifId,
            title: "Test Notification",
            body: "This is a test notification",
            read,
            createdAt: Date.now()
        };
        await set(notifRef(uid, notifId), testNotif);
        return notifId;
    };

    before(async () => {
        // Sign in once before all tests to get user ID
        const userCred = await signInWithEmailAndPassword(auth, TEST_USER_EMAIL, TEST_USER_PASSWORD);
        testUserId = userCred.user.uid;
        await signOut(auth);
    });

    beforeEach(async () => {
        await signOut(auth);
    });

    afterEach(async () => {
        // Clean up test data
        try {
            const adminCred = await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");
            await remove(userNotificationsRef(testUserId));
            await signOut(auth);
        } catch (error) {
            console.error("Cleanup error:", error);
        }
    });

    describe("markNotificationRead", () => {
        it("should mark a notification as read", async () => {
            // Sign in as test user
            const userCred = await signInWithEmailAndPassword(auth, TEST_USER_EMAIL, TEST_USER_PASSWORD);
            
            // Create a test notification
            const notifId = await createTestNotification(testUserId, false);
            
            // Mark as read
            await update(notifRef(testUserId, notifId), {
                read: true,
                readAt: Date.now()
            });

            // Verify update
            const snapshot = await get(notifRef(testUserId, notifId));
            const notification = snapshot.val();

            expect(notification.read).to.be.true;
            expect(notification.readAt).to.exist;
        });
    });

    describe("clearNotifications", () => {
        it("should clear all notifications for a user", async () => {
            // Sign in as test user
            const userCred = await signInWithEmailAndPassword(auth, TEST_USER_EMAIL, TEST_USER_PASSWORD);
            
            // Create multiple test notifications
            await Promise.all([
                createTestNotification(testUserId, false),
                createTestNotification(testUserId, true)
            ]);

            // Clear all notifications
            await remove(userNotificationsRef(testUserId));

            // Verify all notifications are cleared
            const snapshot = await get(userNotificationsRef(testUserId));
            expect(snapshot.exists()).to.be.false;
        });
    });
});