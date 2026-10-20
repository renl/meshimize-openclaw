// Test-environment identities only; replacement provenance is reviewed by SDET.
export function selectImages(env) {
  const names = ["MESHIMIZE_TEST_RUNTIME", "MESHIMIZE_TEST_SERVER", "MESHIMIZE_TEST_POSTGRES"];
  const values = names.map((name) => env[name]);
  if (values.every((value) => value === undefined))
    return {
      runtime: "sha256:5c2b8f89fa8d40ec311a1d42f5871c6d9d3274182e18d837a667597556673084",
      server: "sha256:4a77a71f0e3290f0158bd94362db48abe6b7d2eb0c8cc15eaf6195307b6f55d3",
      postgres: "postgres:16",
      replacement: false,
    };
  if (!values.every((value) => /^sha256:[a-f0-9]{64}$/.test(value ?? "")))
    throw Error("Replacement requires all three exact local image IDs; tags are forbidden");
  return { runtime: values[0], server: values[1], postgres: values[2], replacement: true };
}
