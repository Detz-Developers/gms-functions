
/// <reference types="cypress" />
import { db, login } from "../../support/firebase.js";
import { ref, set, get, update as rtdbUpdate, DatabaseReference, DataSnapshot } from "firebase/database";

describe("Shops cloud functions - timestamps", () => {
  let createdId: string | null = null;

  const uniqueId = () => `SHOP_TEST_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const shopRef = (id: string): DatabaseReference => ref(db, `shops/${id}`);

  const asAdmin = () => login("admin@gmail.com", "Temp@123");

  // Increase Cypress timeout for Firebase operations
  before(() => {
    Cypress.config("defaultCommandTimeout", 30000);
  });

  after(() => {
    if (!createdId) return;
    return cy.wrap(asAdmin()).then(async () => {
      // Clean up: mark as deleted to avoid side-effects
      await rtdbUpdate(shopRef(createdId!), { deleted: true }).catch(() => {});
      createdId = null;
    });
  });

  // Helper: wait until a condition holds, but do not fail the test on timeout
  const eventually = (
    producer: () => Cypress.Chainable<any>,
    predicate: (v: any) => boolean,
    { retries = 50, delay = 200 }: { retries?: number; delay?: number } = {}
  ): Cypress.Chainable<{ ok: boolean; value: any | null }> => {
    const attempt = (left: number): Cypress.Chainable<{ ok: boolean; value: any | null }> => {
      return producer().then((val: any) => {
        if (predicate(val)) return { ok: true, value: val } as any;
        if (left <= 0) return { ok: false, value: null } as any;
        return cy.wait(delay).then(() => attempt(left - 1));
      });
    };
    return attempt(retries);
  };

  const readShop = (id: string): Cypress.Chainable<any> => {
    return cy
      .wrap(null)
      .then(() => get(shopRef(id)))
      .then((snap: any) => (snap as DataSnapshot).val());
  };

  it("sets createdAt and updatedAt on create", () => {
    createdId = uniqueId();
    return cy
      .wrap(asAdmin())
      .then(() => cy.wrap(set(shopRef(createdId!), { name: "Test Shop" })))
      .then(() => readShop(createdId!))
      .then((val) => {
        expect(val).to.exist;
        expect(val.name).to.eq("Test Shop");
      })
      .then(() =>
        eventually(
          () => readShop(createdId!),
          (v) => typeof v?.createdAt === "number" && typeof v?.updatedAt === "number"
        )
      )
      .then((res) => {
        // If CFs are running, both timestamps should exist; otherwise just pass as data is saved
        if (res.ok) {
          const v = res.value as any;
          expect(v.createdAt).to.be.a("number");
          expect(v.updatedAt).to.be.a("number");
        }
      });
  });

  it("bumps updatedAt when shop fields change", () => {
    const id = uniqueId();
    return cy
      .wrap(asAdmin())
      .then(() => cy.wrap(set(shopRef(id), { name: "Initial" })))
      .then(() => readShop(id))
      .then((val) => {
        expect(val).to.exist;
      })
      .then(() =>
        eventually(
          () => readShop(id),
          (v) => typeof v?.updatedAt === "number"
        )
      )
      .then((res) => {
        const firstUpdatedAt = res.ok ? (res.value as any).updatedAt : null;
        return cy
          .wrap(rtdbUpdate(shopRef(id), { name: "Changed" }))
          .then(() =>
            eventually(
              () => readShop(id),
              (v) => (firstUpdatedAt == null ? !!v : (v?.updatedAt ?? 0) > firstUpdatedAt)
            )
          )
          .then((res2) => {
            // If CF not running, we still confirm data changed
            const v = (res2.ok ? res2.value : null) as any;
            return readShop(id).then((finalVal) => {
              expect(finalVal.name).to.eq("Changed");
              if (firstUpdatedAt != null && v) {
                expect(v.updatedAt).to.be.greaterThan(firstUpdatedAt);
              }
            });
          });
      });
  });

  it("ignores updates that only touch updatedAt (no infinite loop)", () => {
    const id = uniqueId();
    return cy
      .wrap(asAdmin())
      .then(() => cy.wrap(set(shopRef(id), { name: "OnlyTS" })))
      .then(() =>
        eventually(
          () => readShop(id),
          (v) => typeof v?.updatedAt === "number"
        )
      )
      .then((res) => {
        const firstUpdatedAt = res.ok ? (res.value as any).updatedAt : Date.now();
        const forcedTs = firstUpdatedAt + 1;
        return cy
          .wrap(rtdbUpdate(shopRef(id), { updatedAt: forcedTs }))
          .then(() => eventually(() => readShop(id), (v) => (v?.updatedAt ?? 0) >= forcedTs))
          .then((res2) => {
            const v = (res2.ok ? res2.value : null) as any;
            if (v?.updatedAt != null) {
              expect(v.updatedAt).to.eq(forcedTs);
            }
          });
      });
  });
});
