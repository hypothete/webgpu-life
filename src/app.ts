//// CONSTANTS AND INIT ////
let timestep = 0;
let computeTexture: GPUTexture;
let computeCopyTexture: GPUTexture;
start();

async function start() {
  //// GPU RESOURCE SETUP ////
  if (!navigator.gpu) throw Error("WebGPU not supported.");

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw Error("Couldn't request WebGPU adapter.");

  const device = await adapter.requestDevice();
  if (!device) throw Error("Couldn't request WebGPU logical device.");

  const canvas = document.querySelector('canvas');
  if (!canvas) throw Error("No canvas element found.");

  const context = canvas.getContext('webgpu');
  if (!context) throw Error("Couldn't create a WebGPU context.");

  const noSupport: HTMLDivElement | null = document.querySelector('.no-support');
  if (noSupport) {
    noSupport.style.display = 'none';
  }
  
  //// LOAD RELEVANT FILES ////
  const computeWGSL = await fetch('/compute.wgsl')
    .then(response => response.text());

  const fullscreenTexturedQuadWGSL = await fetch('/fullscreen-textured-quad.wgsl')
    .then(response => response.text());

  //// CANVAS SETUP ////
  const presentationFormat = context.getPreferredFormat(adapter);
  let presentationSize: [number, number]  = [0, 0];

  function configureCanvasSize () {
    if (!canvas || !context) return;
    timestep = 0;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const devicePixelRatio = window.devicePixelRatio || 1;
    presentationSize = [
      canvas.clientWidth * devicePixelRatio,
      canvas.clientHeight * devicePixelRatio,
    ];
    context.configure({
      device,
      format: presentationFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      size: presentationSize,
      compositingAlphaMode: "premultiplied"
    });

    if (computeTexture) {
      computeTexture = device.createTexture({
        size: presentationSize,
        format: 'rgba8unorm',
        usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC
      });
    
      computeCopyTexture = device.createTexture({
        size: presentationSize,
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
      });
    }
  }

  configureCanvasSize();

  window.addEventListener('resize', configureCanvasSize);

  //// PIPELINE AND BIND GROUP LAYOUT SETUP ////
  const computeBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        buffer: {
          type: 'uniform',
        }
      },
      {
        binding: 1,
        visibility: GPUShaderStage.COMPUTE,
        sampler: {
          type: 'filtering'
        }
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        texture: {
          sampleType: 'float'
        }
      },
      {
        binding: 3,
        visibility: GPUShaderStage.COMPUTE,
        storageTexture: {
          format: 'rgba8unorm',
          access: 'write-only'
        }
      }
    ]
  });

  const computePipeline = device.createComputePipeline({
    compute: {
      module: device.createShaderModule({
        code: computeWGSL,
      }),
      entryPoint: "main",
    },
    layout: device.createPipelineLayout({
      bindGroupLayouts: [computeBindGroupLayout]
    })
  });

  const renderBindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        sampler: {
          type: 'filtering'
        }
      },
      {
        binding: 1,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {
          sampleType: 'float'
        }
      },
    ]
  });

  const renderPipeline = device.createRenderPipeline({
    vertex: {
      module: device.createShaderModule({
        code: fullscreenTexturedQuadWGSL,
      }),
      entryPoint: 'vert_main',
    },
    fragment: {
      module: device.createShaderModule({
        code: fullscreenTexturedQuadWGSL,
      }),
      entryPoint: 'frag_main',
      targets: [
        {
          format: presentationFormat,
        },
      ],
    },
    primitive: {
      topology: 'triangle-list',
    },
    layout: device.createPipelineLayout({
      bindGroupLayouts: [renderBindGroupLayout]
    })
  });

  //// TEXTURE SETUP ////
  const sampler = device.createSampler({
    magFilter: 'nearest',
    minFilter: 'nearest',
    addressModeU: 'repeat',
    addressModeV: 'repeat',
  });

  computeTexture = device.createTexture({
    size: presentationSize,
    format: 'rgba8unorm',
    usage:
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.STORAGE_BINDING |
    GPUTextureUsage.COPY_SRC
  });

  computeCopyTexture = device.createTexture({
    size: presentationSize,
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
  });
  
  //// COMPUTE UNIFORMS ////
  const uniformData = Float32Array.from([
    ...presentationSize,
    timestep
  ])
  const uniformBuffer = device.createBuffer({
    size: uniformData.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true
  });
  const uniformArray = new Float32Array(uniformBuffer.getMappedRange());
  uniformArray.set(uniformData);
  uniformBuffer.unmap();

  //// RENDER LOOP ////
  requestAnimationFrame(frame);

  function frame () {
    if (!canvas || !context) throw Error("Lost rendering context!");
    const commandEncoder = device.createCommandEncoder();

    //// COMPUTE PASS ////
    // update timestep and resolution
    const tsBuffer = Float32Array.from([...presentationSize, timestep]);
    device.queue.writeBuffer(uniformBuffer as GPUBuffer, 0, tsBuffer);

    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(computePipeline);
    computePass.setBindGroup(0, device.createBindGroup({
      layout: computeBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: {
            buffer: uniformBuffer,
          },
        },
        {
          binding: 1,
          resource: sampler,
        },
        {
          binding: 2,
          resource: computeCopyTexture.createView(),
        },
        {
          binding: 3,
          resource: computeTexture.createView(),
        },
      ],
    }));
    // workgroup sizes are 16x16 right now
    computePass.dispatch(
      Math.ceil(presentationSize[0] / 16),
      Math.ceil(presentationSize[1] / 16),
      1
    );
    computePass.end();
    // Copy the updated texture back
    commandEncoder.copyTextureToTexture(
      {
        texture: computeTexture,
      },
      {
        texture: computeCopyTexture,
      },
      presentationSize,
    );

    ////RENDER PASS ////
    const swapChainTexture = context.getCurrentTexture();
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: swapChainTexture.createView(),
          clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    renderPass.setPipeline(renderPipeline);

    // todo memoize bind groups somehow
    renderPass.setBindGroup(0, device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [
        {
          binding: 0,
          resource: sampler,
        },
        {
          binding: 1,
          resource: computeTexture.createView(),
        },
      ],
    }));
    renderPass.draw(6, 1, 0, 0);
    renderPass.end();

    device.queue.submit([commandEncoder.finish()]);
    timestep += 1;
    requestAnimationFrame(frame);
  }
}
