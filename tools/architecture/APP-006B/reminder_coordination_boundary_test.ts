function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("APP-006B keeps interaction-to-planning coordination on public boundaries", async () => {
  const [manifest, interaction, communication, worker] = await Promise.all([
    Deno.readTextFile("docs/architecture/module-boundaries.yaml"),
    Deno.readTextFile(
      "packages/backend/modules/interactions/application/record_interaction.ts",
    ),
    Deno.readTextFile(
      "packages/backend/modules/interactions/application/record_communication.ts",
    ),
    Deno.readTextFile("apps/worker/composition.ts"),
  ]);
  const planningBlock =
    manifest.match(/ {2}- id: planning[\s\S]*?(?=\n {2}- id: files)/)?.[0] ??
      "";
  assert(
    manifest.includes(
      "schemaSource: personal-crm-schema/v7/personal_crm_schema_v7.sql",
    ) &&
      planningBlock.includes("interactions.interaction-recorded") &&
      planningBlock.includes("stay_in_touch_cadence_requests"),
    "canonical v6 or the approved planning consumer edge is missing",
  );
  for (const source of [interaction, communication]) {
    assert(
      !source.includes("modules/planning/adapters") &&
        !source.includes("crm.stay_in_touch_cadences"),
      "interactions bypassed the planning public coordination boundary",
    );
  }
  // GAP-013 moved adapter construction out of `public.ts` into each module's
  // `composition.ts`, which only a declared composition root may import. The
  // worker is such a root, so that file is the boundary it reaches now; what
  // stays forbidden is reaching past it into planning's adapters.
  assert(
    worker.includes("modules/planning/composition.ts") &&
      !worker.includes("modules/planning/adapters") &&
      !worker.includes("scheduled_job_runs"),
    "the reminder worker bypassed the planning module boundary or repurposed observability",
  );
});
