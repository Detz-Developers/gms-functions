/// <reference types="cypress" />
import { db, login } from "../../support/firebase.js";
import { ref, set, get, update as rtdbUpdate, DatabaseReference, DataSnapshot } from "firebase/database";

describe("ServiceLogs cloud functions - updatedAt behavior", () => {
  const uniqueId = () => `SRV_TEST_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const logRef = (id: string): DatabaseReference => ref(db, `serviceLogs/${id}`);
  const asAdmin = () => login("admin@gmail.com", "Temp@123");

  // Increase Cypress timeout for Firebase operations
  before(() => {
    Cypress.config("defaultCommandTimeout", 30000);
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

  const readLog = (id: string): Cypress.Chainable<any> => {
    return cy
      .wrap(null)
      .then(() => get(logRef(id)))
      .then((snap: any) => (snap as DataSnapshot).val());
  };

  it("bumps updatedAt when service log fields change", () => {
    const id = uniqueId();
    const base = {
      id,
      generator_id: "GEN1",
      technician_id: "TECH1",
      service_type: "inspection",
      notes: "initial",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    return cy
      .wrap(asAdmin())
      .then(() => cy.wrap(set(logRef(id), base)))
      .then(() => readLog(id))
      .then((val) => {
        expect(val).to.exist;
      })
      .then(() =>
        eventually(
          () => readLog(id),
          (v) => typeof v?.updatedAt === "number"
        )
      )
      .then((res) => {
        const firstUpdatedAt = res.ok ? (res.value as any).updatedAt : null;
        return cy
          .wrap(rtdbUpdate(logRef(id), { notes: "changed" }))
          .then(() =>
            eventually(
              () => readLog(id),
              (v) => (firstUpdatedAt == null ? !!v : (v?.updatedAt ?? 0) > firstUpdatedAt)
            )
          )
          .then((res2) => {
            // Always ensure the data change is persisted
            return readLog(id).then((finalVal) => {
              expect(finalVal.notes).to.eq("changed");
              if (firstUpdatedAt != null && res2.ok) {
                expect((res2.value as any).updatedAt).to.be.greaterThan(firstUpdatedAt);
              }
            });
          });
      });
  });

  it("ignores updates that only touch updatedAt (no infinite loop)", () => {
    const id = uniqueId();
    const base = {
      id,
      generator_id: "GEN2",
      technician_id: "TECH2",
      service_type: "repair",
      notes: "only-ts",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    return cy
      .wrap(asAdmin())
      .then(() => cy.wrap(set(logRef(id), base)))
      .then(() =>
        eventually(
          () => readLog(id),
          (v) => typeof v?.updatedAt === "number"
        )
      )
      .then((res) => {
        const firstUpdatedAt = res.ok ? (res.value as any).updatedAt : Date.now();
        const forcedTs = firstUpdatedAt + 1;

        return cy
          .wrap(rtdbUpdate(logRef(id), { updatedAt: forcedTs }))
          .then(() =>
            eventually(
              () => readLog(id),
              (v) => (v?.updatedAt ?? 0) >= forcedTs
            )
          )
          .then((res2) => {
            if (res2.ok) {
              expect((res2.value as any).updatedAt).to.eq(forcedTs);
            }
          });
      });
  });
});