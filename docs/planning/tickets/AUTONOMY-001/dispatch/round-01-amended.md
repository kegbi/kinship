# AUTONOMY-001 amended RED dispatch

Authoritative input base: `e55f935db7825543757ca7083308ba3126195543`

The draft RED revision `4e79f0d63b3c8433f6ba864caa640dc22b4eae70` is not
authoritative because its integration fixtures used schema version 1 and
contradicted the accepted v2 migration rule.

Before production work:

1. migrate all non-PILOT positive fixtures in both RED suites to the exact v2
   ticket/result/review contract in `ticket.json` and `contract.md`;
2. leave state/events at schema version 1 with the new optional integration
   fields;
3. run both focused suites together and prove the only passing baseline is the
   two explicitly grandfathered PILOT packets; and
4. freeze the amended test blobs and RED revision.

No production, template, skill, agent, or accepted delivery-document change is
authorized until the controller records that amended RED revision.
