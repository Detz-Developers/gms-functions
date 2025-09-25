

import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getDatabase, ref, get, set, update, remove } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
	apiKey: "AIzaSyB4uksA5X1fQoh9kXjN1R5_Vg66N7Muoos",
	authDomain: "genizest.firebaseapp.com",
	databaseURL: "https://genizest-default-rtdb.firebaseio.com",
	projectId: "genizest",
	appId: "1:728207587632:web:2f73ed4c0124d44ceaf0f5",
};

// v2 functions region
const REGION = "us-central1";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const fx = getFunctions(app, REGION);

const issueId = `test-issue-${Date.now()}`;
const issueRef = ref(db, `issues/${issueId}`);

describe("Issues callable functions + trigger", () => {
	before(() => {
		Cypress.config("defaultCommandTimeout", 20000);
		// Ensure clean slate
		cy.wrap(null).then(async () => {
			try {
				// Sign in as admin for cleanup if needed
				await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");
				await auth.currentUser?.getIdToken(true);
			} catch {}
			await remove(issueRef).catch(() => {});
			if (auth.currentUser) await signOut(auth);
		});
	});

	after(() => {
		// Cleanup created test issue as admin
		return (async () => {
			await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");
			await auth.currentUser?.getIdToken(true);
			await remove(issueRef).catch(() => {});
			await signOut(auth);
		})();
	});

	it("reportIssue: technician can create an issue", () => {
		cy.wrap(null).then(async () => {
			// sign in as technician/operator
			await signInWithEmailAndPassword(auth, "tech@gmail.com", "Temp@123");
			await auth.currentUser?.getIdToken(true);

			const callReport = httpsCallable(fx, "reportIssue");
			const payload = {
				id: issueId,
				equipment_type: "generator",
				equipment_id: "gen-123",
				description: "Low voltage output",
				severity: "high",
			};

			const res: any = await callReport(payload);
			expect(res?.data?.ok).to.equal(true);
			expect(res?.data?.id).to.equal(issueId);

			// verify in DB
			const snap = await get(issueRef);
			expect(snap.exists()).to.equal(true);
			const val = snap.val();
			expect(val.id).to.equal(issueId);
			expect(val.equipment_type).to.equal("generator");
			expect(val.status).to.equal("open");
			expect(val.createdBy).to.be.a("string");
			expect(val.createdByRole).to.be.oneOf(["technician", "operator"]);
			expect(val.createdAt).to.be.a("number");
			expect(val.updatedAt).to.be.a("number");

			await signOut(auth);
		});
	});

	it("assignIssue: admin/inventory can assign technician", () => {
		cy.wrap(null).then(async () => {
			// sign in as admin
			await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");
			await auth.currentUser?.getIdToken(true);

			const callAssign = httpsCallable(fx, "assignIssue");
			const res: any = await callAssign({ id: issueId, technician_id: "tech-uid-001" });
			expect(res?.data?.ok).to.equal(true);

			const snap = await get(issueRef);
			const val = snap.val();
			expect(val.assigned_to).to.equal("tech-uid-001");

			await signOut(auth);
		});
	});

	it("setIssueStatus: assigned tech or admin can change status", () => {
		cy.wrap(null).then(async () => {
			// use admin to change status
			await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");
			await auth.currentUser?.getIdToken(true);

			const callSetStatus = httpsCallable(fx, "setIssueStatus");
			const res: any = await callSetStatus({ id: issueId, status: "in_progress" });
			expect(res?.data?.ok).to.equal(true);

			const snap = await get(issueRef);
			const val = snap.val();
			expect(val.status).to.equal("in_progress");
			expect(val.updatedAt).to.be.a("number");

			await signOut(auth);
		});
	});

	it("update trigger: changing a field bumps updatedAt automatically", () => {
		cy.wrap(null).then(async () => {
			// any authenticated user can write issues per rules
			await signInWithEmailAndPassword(auth, "tech@gmail.com", "Temp@123");
			await auth.currentUser?.getIdToken(true);

			const beforeSnap = await get(issueRef);
			const beforeVal = beforeSnap.val();
			const beforeUpdated = beforeVal?.updatedAt || 0;

			// change a different field; trigger should set updatedAt
			await update(issueRef, { description: "Low voltage persists after load", severity: "medium" });

			// wait briefly for trigger to execute
			await new Promise((r) => setTimeout(r, 1200));

			const afterSnap = await get(issueRef);
			const afterVal = afterSnap.val();
			expect(afterVal.description).to.equal("Low voltage persists after load");
			expect(afterVal.severity).to.equal("medium");
			expect(afterVal.updatedAt).to.be.a("number");
			expect(afterVal.updatedAt).to.be.greaterThan(beforeUpdated);

			await signOut(auth);
		});
	});

  /*
	it("linkGatePass: inventory/admin can link a gate pass", () => {
		cy.wrap(null).then(async () => {
			// sign in as admin (or inventory role)
			await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");
			await auth.currentUser?.getIdToken(true);

			const callLink = httpsCallable(fx, "linkGatePass");
			const res: any = await callLink({ id: issueId, gate_pass_id: "gate-777" });
			expect(res?.data?.ok).to.equal(true);

			const snap = await get(issueRef);
			const val = snap.val();
			expect(val.gate_pass).to.equal("gate-777");
			expect(val.updatedAt).to.be.a("number");

			await signOut(auth);
		});
	});
*/
});