{/*
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyB4uksA5X1fQoh9kXjN1R5_Vg66N7Muoos", // replace with real one for live, emulator ok with fake
  authDomain: "genizest.firebaseapp.com",
  projectId: "genizest",
  appId: "1:728207587632:web:2f73ed4c0124d44ceaf0f5",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app, "us-central1"); // match REGION

describe("Generator Functions (Realtime Database)", () => {
  let createdId: string;

  // clean up if test crashes
  afterEach(async () => {
    if (createdId) {
      try {
        const delFn = httpsCallable(functions, "deleteGenerator");
        await delFn({ id: createdId });
      } catch {}
      createdId = "";
    }
    await signOut(auth);
  });

  it("should allow admin to create generator", () => {
  cy.wrap(null).then(() => {
    return (async () => {   // <-- return the async function
      await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");
      const createFn = httpsCallable(functions, "createGenerator");
      const res: any = await createFn({
        brand: "Honda",
        serial_no: "SN999",
        shop_id: "shop-001",
        status: "Active",
        location: "UP",
        hasAutoStart: true,
        hasBatteryCharger: false,
      });
      expect(res.data.ok).to.eq(true);
      expect(res.data.id).to.match(/^GN\d+$/);
      createdId = res.data.id;
    })();
  });
});

  it("should deny non-admin from creating generator", () => {
  cy.wrap(null).then(async () => {
    await signInWithEmailAndPassword(auth, "tech@gmail.com", "Temp@123");
    const createFn = httpsCallable(functions, "createGenerator");

    try {
      await createFn({
        brand: "Yamaha",
        serial_no: "SN124",
        shop_id: "shop-002",
        status: "Active",
        location: "DOWN",
      });
      throw new Error("expected permission-denied");
    } catch (err: any) {
      const code = err.code?.replace("functions/", "");
      expect(code).to.eq("permission-denied");
    }
  });
});


  it("should allow admin to update generator status", () => {
    cy.wrap(null).then(async () => {
      // login as admin
      await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");

      // create a generator first
      const createFn = httpsCallable(functions, "createGenerator");
      const res: any = await createFn({
        brand: "TestBrand",
        serial_no: "SN125",
        shop_id: "shop-003",
        status: "Active",
        location: "UP",
      });
      createdId = res.data.id;

      // update its status
      const setStatusFn = httpsCallable(functions, "setGeneratorStatus");
      const upd: any = await setStatusFn({ id: createdId, status: "Unusable" });

      expect(upd.data.ok).to.eq(true);
    });
  });

  it("should allow admin to delete generator", () => {
    cy.wrap(null).then(async () => {
      await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");

      // create then delete
      const createFn = httpsCallable(functions, "createGenerator");
      const res: any = await createFn({
        brand: "DeleteBrand",
        serial_no: "SN126",
        shop_id: "shop-004",
        status: "Active",
        location: "DOWN",
      });
      const delId = res.data.id;

      const delFn = httpsCallable(functions, "deleteGenerator");
      const delRes: any = await delFn({ id: delId });
      expect(delRes.data.ok).to.eq(true);
      expect(delRes.data.id).to.eq(delId);
    });
  });
});
*/}

import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getDatabase, ref, get, update as rtdbUpdate } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
	apiKey: "AIzaSyB4uksA5X1fQoh9kXjN1R5_Vg66N7Muoos",
	authDomain: "genizest.firebaseapp.com",
	databaseURL: "https://genizest-default-rtdb.firebaseio.com",
	projectId: "genizest",
	appId: "1:728207587632:web:2f73ed4c0124d44ceaf0f5",
};

const REGION = "us-central1";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const fx = getFunctions(app, REGION);

describe("Generators callable functions + onGeneratorUpdate trigger", () => {
	let createdId: string | null = null;

	const asAdmin = async () => {
		await signInWithEmailAndPassword(auth, "admin@gmail.com", "Temp@123");
		await auth.currentUser?.getIdToken(true);
	};
	const asTech = async () => {
		await signInWithEmailAndPassword(auth, "tech@gmail.com", "Temp@123");
		await auth.currentUser?.getIdToken(true);
	};
	const signOutAll = async () => {
		if (auth.currentUser) await signOut(auth);
	};

	before(() => {
		Cypress.config("defaultCommandTimeout", 25000);
	});

	after(() => {
		// Best-effort cleanup via callable deleteGenerator
		return (async () => {
			if (!createdId) return;
			try {
				await asAdmin();
				const del = httpsCallable(fx, "deleteGenerator");
				await del({ id: createdId }).catch(() => {});
			} finally {
				await signOutAll();
			}
		})();
	});

	it("createGenerator: admin can create generator", () => {
		cy.wrap(null).then(async () => {
			await asAdmin();

			const create = httpsCallable(fx, "createGenerator");
			const res: any = await create({
				brand: "Honda",
				size: "5kVA",
				serial_no: `SN-${Date.now()}`,
				issued_date: null,
				installed_date: null,
				status: "Active",
				shop_id: "shop-001",
				location: "UP",
				hasAutoStart: true,
				hasBatteryCharger: "yes",
				warranty: null,
				extracted_parts: [],
			});

			expect(res?.data?.ok).to.equal(true);
			createdId = res.data.id as string;
			expect(createdId).to.match(/^GN\d{4,}$/);

			const snap = await get(ref(db, `generators/${createdId}`));
			expect(snap.exists()).to.equal(true);
			const val = snap.val();
			expect(val.id).to.equal(createdId);
			expect(val.brand).to.equal("Honda");
			expect(val.status).to.equal("Active");
			expect(val.location).to.equal("UP");
			expect(val.hasAutoStart).to.equal(1);
			expect(val.hasBatteryCharger).to.equal(1);
			expect(val.createdAt).to.be.a("number");
			expect(val.updatedAt).to.be.a("number");

			await signOutAll();
		});
	});


	it("updateGenerator: admin can update fields and normalization applies", () => {
		cy.wrap(null).then(async () => {
			expect(createdId, "generator must be created first").to.be.a("string");
			await asAdmin();

			const updateGen = httpsCallable(fx, "updateGenerator");
			const res: any = await updateGen({
				id: createdId,
				size: "7.5kVA",
				location: "DOWN",
				hasAutoStart: "no",
				hasBatteryCharger: 0,
				warranty: "12m",
			});
			expect(res?.data?.ok).to.equal(true);

			const snap = await get(ref(db, `generators/${createdId}`));
			const val = snap.val();
			expect(val.size).to.equal("7.5kVA");
			expect(val.location).to.equal("DOWN");
			expect(val.hasAutoStart).to.equal(0);
			expect(val.hasBatteryCharger).to.equal(0);
			expect(val.warranty).to.equal("12m");
			expect(val.updatedAt).to.be.a("number");

			await signOutAll();
		});
	});

	it("setGeneratorStatus: admin can set status and it persists", () => {
		cy.wrap(null).then(async () => {
			expect(createdId).to.be.a("string");
			await asAdmin();

			const setStatus = httpsCallable(fx, "setGeneratorStatus");
			const res: any = await setStatus({ id: createdId, status: "Under Repair" });
			expect(res?.data?.ok).to.equal(true);

			const snap = await get(ref(db, `generators/${createdId}`));
			const val = snap.val();
			expect(val.status).to.equal("Under Repair");
			expect(val.updatedAt).to.be.a("number");

			await signOutAll();
		});
	});

	it("onGeneratorUpdate trigger: direct data change bumps updatedAt", () => {
		cy.wrap(null).then(async () => {
			expect(createdId).to.be.a("string");
			// Only admin can write to /generators per rules
			await asAdmin();

			const r = ref(db, `generators/${createdId}`);
			const beforeSnap = await get(r);
			const beforeVal = beforeSnap.val() || {};
			const beforeUpdated = beforeVal.updatedAt || 0;

			// update a field other than updatedAt
			await rtdbUpdate(r, { brand: "Honda Power" });

			// allow time for the trigger to run
			await new Promise((rsv) => setTimeout(rsv, 1200));

			const afterSnap = await get(r);
			const afterVal = afterSnap.val() || {};
			expect(afterVal.brand).to.equal("Honda Power");
			expect(afterVal.updatedAt).to.be.a("number");
			expect(afterVal.updatedAt).to.be.greaterThan(beforeUpdated);

			await signOutAll();
		});
	});

	it("deleteGenerator: admin can delete generator", () => {
		cy.wrap(null).then(async () => {
			expect(createdId).to.be.a("string");
			await asAdmin();

			const del = httpsCallable(fx, "deleteGenerator");
			const res: any = await del({ id: createdId });
			expect(res?.data?.ok).to.equal(true);
			expect(res?.data?.id).to.equal(createdId);

			const snap = await get(ref(db, `generators/${createdId}`));
			expect(snap.exists()).to.equal(false);

			await signOutAll();
			createdId = null;
		});
	});
});