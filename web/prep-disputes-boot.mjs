/** Early boot — mount dispute UI before app.js (avoids stale import-chain cache). */
import { initDisputeUiEarly } from "./prep-disputes.js?v=dispute-static-v11";

initDisputeUiEarly();
