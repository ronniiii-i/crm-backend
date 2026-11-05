-- Stage 8: composite tenant indexes for workspace list queries.
--
-- The records API always filters by `tenantId` and orders by the entity's
-- default sort (usually `createdAt`, or `lastName` for contacts). A plain
-- `tenantId` index still forces Postgres to sort the full tenant slice, which
-- becomes visible once a workspace has 10k+ rows. These composite indexes let
-- the same queries use an ordered index scan.

CREATE INDEX "Contact_tenantId_lastName_idx"
  ON "Contact" ("tenantId", "lastName");
CREATE INDEX "Contact_tenantId_createdAt_idx"
  ON "Contact" ("tenantId", "createdAt");

CREATE INDEX "Deal_tenantId_createdAt_idx"
  ON "Deal" ("tenantId", "createdAt");

CREATE INDEX "Expense_tenantId_createdAt_idx"
  ON "Expense" ("tenantId", "createdAt");

CREATE INDEX "Invoice_tenantId_createdAt_idx"
  ON "Invoice" ("tenantId", "createdAt");

CREATE INDEX "Task_tenantId_createdAt_idx"
  ON "Task" ("tenantId", "createdAt");

CREATE INDEX "SupportTicket_tenantId_createdAt_idx"
  ON "SupportTicket" ("tenantId", "createdAt");

CREATE INDEX "InventoryItem_tenantId_createdAt_idx"
  ON "InventoryItem" ("tenantId", "createdAt");

CREATE INDEX "Project_tenantId_createdAt_idx"
  ON "Project" ("tenantId", "createdAt");
