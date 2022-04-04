struct Uniforms {
  resolution: vec2<f32>,
  timestep: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var mySampler : sampler;
@group(0) @binding(2) var computeCopyTexture : texture_2d<f32>;
@group(0) @binding(3) var outputTex: texture_storage_2d<rgba16float, write>;

var<private> RNGSTATE: u32 = 42u;

fn pcgHash() -> u32 {
  let state = RNGSTATE;
  RNGSTATE = RNGSTATE * 747796405u + 2891336453u;
  let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

fn randomFloat() -> f32 {
  return f32(pcgHash()) / 4294967296.0;
}

fn getAt(uv: vec2<f32>) -> f32 {
  return textureSampleLevel(computeCopyTexture, mySampler, uv, 0.0).g;
}

@stage(compute) @workgroup_size(16, 16, 1)
fn main(
    @builtin(global_invocation_id) global_id : vec3<u32>,
    @builtin(local_invocation_id) local_id : vec3<u32>,
  ) {

  let x = f32(global_id.x);
  let y = f32(global_id.y);

  let uv = vec2<f32>(
    (x / uniforms.resolution.x),
    (y / uniforms.resolution.y)
  );

  let dx = 1.0 / uniforms.resolution.x;
  let dy = 1.0 / uniforms.resolution.y;

  var col = vec4(0.0, 0.0, 0.0, 1.0);
  // green field is new or sustained life
  // blue field is dying life

  RNGSTATE = u32(uniforms.timestep * x * y);

  if (uniforms.timestep < 2.0) {
    // seed the field
    col.g = step(0.5, randomFloat());
  }

  else {

    let c = getAt(uv);
    let nw = getAt(uv + vec2<f32>(-dx, -dy));
    let n  = getAt(uv + vec2<f32>(0.0, -dy));
    let ne = getAt(uv + vec2<f32>(dx,  -dy));
    let w  = getAt(uv + vec2<f32>(-dx, 0.0));
    let e  = getAt(uv + vec2<f32>(dx,  0.0));
    let sw = getAt(uv + vec2<f32>(-dx,  dy));
    let s  = getAt(uv + vec2<f32>(0.0,  dy));
    let se = getAt(uv + vec2<f32>(dx,   dy));

    let nSum = nw + n + ne + w + e + sw + s + se;

    if (c > 0.0) {
      // alive

      // kill if overpopulated or underpopulated
      if (nSum < 2.0 || nSum > 3.0) {
        col.g = 0.0;
        col.r = 1.0;
      } else {
        col.g = 1.0;
      }

    } else {
      // dead

      // add life if healthy population
      if (nSum == 3.0) {
        col.g = 1.0;
      }
    }
  }

  textureStore(
    outputTex,
    vec2<i32>(i32(x),i32(y)),
    col
  );
}