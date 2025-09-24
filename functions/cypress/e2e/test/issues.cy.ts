import { initializeApp } from "firebase/app";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: "demo-api-key",      // oyage Firebase config eken denna
  authDomain: "demo.firebaseapp.com",
  projectId: "demo-project",
  appId: "1:1234567890:web:abcdef",
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app, "us-central1");

describe("Issues Functions", () => {
  it("✅ should allow authenticated user to report issue", () => {
    cy.wrap(null).then(async () => {
      const fn = httpsCallable(functions, "reportIssue");
      const res: any = await fn({
        id: "issue-001",
        equipment_type: "generator",
        equipment_id: "gen-123",
        description: "Generator making noise",
        severity: "high",
      });
      expect(res.data.ok).to.eq(true);
      expect(res.data.id).to.eq("issue-001");
    });
  });

  it("❌ should deny unauthenticated user reporting issue", () => {
    cy.wrap(null).then(async () => {
      const fn = httpsCallable(functions, "reportIssue");
      try {
        await fn({
          id: "issue-002",
          equipment_type: "battery",
          equipment_id: "bat-001",
          description: "Battery not charging",
        });
      } catch (err: any) {
        expect(err.message).to.include("unauthenticated");
      }
    });
  });

  it("✅ should allow admin to assign technician", () => {
    cy.wrap(null).then(async () => {
      const fn = httpsCallable(functions, "assignIssue");
      const res: any = await fn({
        id: "issue-001",
        technician_id: "tech-007",
      });
      expect(res.data.ok).to.eq(true);
    });
  });

  it("✅ should allow updating issue status", () => {
    cy.wrap(null).then(async () => {
      const fn = httpsCallable(functions, "setIssueStatus");
      const res: any = await fn({ id: "issue-001", status: "in-progress" });
      expect(res.data.ok).to.eq(true);
    });
  });

  it("✅ should allow inventory staff to link gate pass", () => {
    cy.wrap(null).then(async () => {
      const fn = httpsCallable(functions, "linkGatePass");
      const res: any = await fn({ id: "issue-001", gate_pass_id: "gate-123" });
      expect(res.data.ok).to.eq(true);
    });
  });
});
