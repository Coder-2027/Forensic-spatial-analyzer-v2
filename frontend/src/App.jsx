import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, Grid, useGLTF } from "@react-three/drei";

function Model() {
  const { scene } = useGLTF("/models/scene_textured.glb");

  return (
    <primitive
      object={scene}
      scale={1}
      position={[0, 0, 0]}
      rotation={[Math.PI, 0, 0]}
    />
  );
}

function App() {
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#111" }}>
      <Canvas
        camera={{
          position: [5, 4, 5],
          fov: 50,
        }}
      >
        <ambientLight intensity={1.5} />
        <directionalLight position={[5, 10, 5]} intensity={2} />

        <Grid
          infiniteGrid
          cellSize={0.5}
          sectionSize={2}
          fadeDistance={30}
        />

        <Model />

        <OrbitControls />
        <Environment preset="city" />
      </Canvas>
    </div>
  );
}

useGLTF.preload("/models/scene_textured.glb");

export default App;