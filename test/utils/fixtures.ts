import path from "path";

const testDir = path.join(__dirname, "..");
export const getFixturePath = (...parts: string[]) =>
	path.join(testDir, "fixtures", ...parts);
