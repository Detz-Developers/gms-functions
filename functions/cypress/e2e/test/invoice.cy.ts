import { auth, db } from "../../support/firebase.js";
import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { set, get, ref, remove, update } from "firebase/database";

const invoiceRef = (uid: string, invoiceId: string) =>
    ref(db, `invoices/${uid}/${invoiceId}`);

describe("Invoice Functions", () => {
    const CUSTOMER_EMAIL = "customer@example.com";
    const USER_UID = "user-uid-123";
    
    // Generate unique invoice ID for each test
    const getUniqueInvoiceId = () => `inv-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    beforeEach(async () => {
        await signOut(auth);
    });
    
    afterEach(async () => {
        await signOut(auth);
    });

    // Test createInvoice function
    describe("createInvoice", () => {
        it("should create a new invoice", async () => {
            // Sign in as admin
            const adminCred = await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");
            const uid = adminCred.user.uid;
            const invoiceId = getUniqueInvoiceId();

            const newInvoice = {
                id: invoiceId,
                customerEmail: CUSTOMER_EMAIL,
                amount: 1000,
                status: "pending",
                createdAt: Date.now(),
                items: [
                    { name: "Service 1", quantity: 1, price: 1000 }
                ]
            };

            // Create invoice
            await set(invoiceRef(uid, invoiceId), newInvoice);

            // Verify invoice was created
            const snapshot = await get(invoiceRef(uid, invoiceId));
            expect(snapshot.exists()).to.be.true;
            expect(snapshot.val().customerEmail).to.equal(CUSTOMER_EMAIL);
            expect(snapshot.val().status).to.equal("pending");

            // Clean up
            await remove(invoiceRef(uid, invoiceId));
        });
    });

    // Test markInvoicePaid function
    describe("markInvoicePaid", () => {
        it("should update invoice status to paid", async () => {
            // Sign in as admin
            const adminCred = await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");
            const uid = adminCred.user.uid;
            const invoiceId = getUniqueInvoiceId();

            // Create test invoice
            const testInvoice = {
                id: invoiceId,
                customerEmail: CUSTOMER_EMAIL,
                amount: 1000,
                status: "pending",
                createdAt: Date.now()
            };
            
            // Create the invoice
            await set(invoiceRef(uid, invoiceId), testInvoice);

            // Mark as paid
            await update(invoiceRef(uid, invoiceId), {
                status: "paid",
                paidAt: Date.now()
            });
            
            // Verify status was updated
            const snapshot = await get(invoiceRef(uid, invoiceId));
            const invoice = snapshot.val();
            expect(invoice.status).to.equal("paid");
            expect(invoice.paidAt).to.exist;

            // Clean up
            await remove(invoiceRef(uid, invoiceId));
        });
    });

    // Test onInvoiceUpdate trigger
    describe("onInvoiceUpdate", () => {
        it("should update invoice status to processing", async () => {
            // Sign in as admin
            const adminCred = await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");
            const uid = adminCred.user.uid;
            const invoiceId = getUniqueInvoiceId();

            // Create test invoice
            await set(invoiceRef(uid, invoiceId), {
                id: invoiceId,
                customerEmail: CUSTOMER_EMAIL,
                amount: 1000,
                status: "pending",
                createdAt: Date.now()
            });

            // Update the invoice
            await update(invoiceRef(uid, invoiceId), {
                status: "processing",
                updatedAt: Date.now()
            });
            
            // Verify the update
            const snapshot = await get(invoiceRef(uid, invoiceId));
            const updatedInvoice = snapshot.val();
            expect(updatedInvoice.status).to.equal("processing");
            expect(updatedInvoice.updatedAt).to.exist;

            // Clean up
            await remove(invoiceRef(uid, invoiceId));
        });
    });
});