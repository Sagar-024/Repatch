import * as fs from "fs";
import * as path from "path";
import { ReviewAgent } from "../src/review-agent.js";

async function runTest() {
  const dummyFilePath = path.resolve(process.cwd(), "dummy_file.js");
  const dummyContent = `
function processData(data) {
  // Dangerous: using eval on user input
  return eval(data);
}

const result = processData("2 + 2");
console.log(result);
`;

  console.log("🛠️ Creating dummy file with security flaw...");
  fs.writeFileSync(dummyFilePath, dummyContent, "utf-8");

  console.log("🤖 Running ReviewAgent on dummy file...");
  const agent = new ReviewAgent();
  const finalState = await agent.run(dummyFilePath);

  console.log("\n📊 Final Agent State:");
  console.log(JSON.stringify(finalState, null, 2));

  console.log("\n📄 Checking if file was patched...");
  const patchedContent = fs.readFileSync(dummyFilePath, "utf-8");
  console.log("--- Patched Content ---");
  console.log(patchedContent);
  console.log("-----------------------");

  if (patchedContent.includes("eval")) {
    console.log("❌ Test Failed: 'eval' still present in the file.");
  } else {
    console.log("✅ Test Passed: 'eval' was removed or replaced.");
  }

  // Cleanup
  // fs.unlinkSync(dummyFilePath);
}

runTest().catch(console.error);
