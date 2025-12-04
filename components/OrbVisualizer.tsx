'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

interface OrbProps {
  isSpeaking: boolean
  inputAnalyser: AnalyserNode | null
  outputAnalyser: AnalyserNode | null
}

export default function OrbVisualizer({ isSpeaking, inputAnalyser, outputAnalyser }: OrbProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  
  // Refs to hold latest values without triggering re-renders
  const stateRef = useRef({ isSpeaking, inputAnalyser, outputAnalyser })

  // Update refs when props change
  useEffect(() => {
    stateRef.current = { isSpeaking, inputAnalyser, outputAnalyser }
  }, [isSpeaking, inputAnalyser, outputAnalyser])

  useEffect(() => {
    if (!mountRef.current) return

    // --- SCENE SETUP ---
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0a0a0a) 

    const camera = new THREE.PerspectiveCamera(75, mountRef.current.clientWidth / mountRef.current.clientHeight, 0.1, 1000)
    camera.position.z = 4

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight)
    renderer.setPixelRatio(window.devicePixelRatio)
    mountRef.current.appendChild(renderer.domElement)

    // --- ORB ---
    const geometry = new THREE.IcosahedronGeometry(1.5, 30)
    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uIntensity: { value: 0.3 },
            uColorA: { value: new THREE.Color("#2E86C1") },
            uColorB: { value: new THREE.Color("#E74C3C") }
        },
        // (Same shaders as before, omitted for brevity but included in render)
        vertexShader: `
            uniform float uTime;
            uniform float uIntensity;
            varying vec2 vUv;
            varying float vDisplacement;
            
            // Simplex Noise
            vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
            vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
            vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
            float snoise(vec3 v) {
                const vec2  C = vec2(1.0/6.0, 1.0/3.0);
                const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
                vec3 i  = floor(v + dot(v, C.yyy) );
                vec3 x0 = v - i + dot(i, C.xxx) ;
                vec3 g = step(x0.yzx, x0.xyz);
                vec3 l = 1.0 - g;
                vec3 i1 = min( g.xyz, l.zxy );
                vec3 i2 = max( g.xyz, l.zxy );
                vec3 x1 = x0 - i1 + C.xxx;
                vec3 x2 = x0 - i2 + C.yyy;
                vec3 x3 = x0 - D.yyy;
                i = mod289(i);
                vec4 p = permute( permute( permute( 
                            i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                          + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
                          + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
                float n_ = 0.142857142857;
                vec3  ns = n_ * D.wyz - D.xzx;
                vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
                vec4 x_ = floor(j * ns.z);
                vec4 y_ = floor(j - 7.0 * x_ );
                vec4 x = x_ *ns.x + ns.yyyy;
                vec4 y = y_ *ns.x + ns.yyyy;
                vec4 h = 1.0 - abs(x) - abs(y);
                vec4 b0 = vec4( x.xy, y.xy );
                vec4 b1 = vec4( x.zw, y.zw );
                vec4 s0 = floor(b0)*2.0 + 1.0;
                vec4 s1 = floor(b1)*2.0 + 1.0;
                vec4 sh = -step(h, vec4(0.0));
                vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
                vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
                vec3 p0 = vec3(a0.xy,h.x);
                vec3 p1 = vec3(a0.zw,h.y);
                vec3 p2 = vec3(a1.xy,h.z);
                vec3 p3 = vec3(a1.zw,h.w);
                vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
                p0 *= norm.x;
                p1 *= norm.y;
                p2 *= norm.z;
                p3 *= norm.w;
                vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
                m = m * m;
                return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                              dot(p2,x2), dot(p3,x3) ) );
            }

            void main() {
                vUv = uv;
                vDisplacement = snoise(position + vec3(2.0 * uTime));
                vec3 newPosition = position + normal * (vDisplacement * uIntensity);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
            }
        `,
        fragmentShader: `
            uniform float uIntensity;
            uniform vec3 uColorA;
            uniform vec3 uColorB;
            varying float vDisplacement;

            void main() {
                float distort = 2.0 * vDisplacement * uIntensity;
                vec3 color = mix(uColorA, uColorB, distort + uIntensity);
                gl_FragColor = vec4(color, 1.0);
            }
        `,
        transparent: true
    })

    const sphere = new THREE.Mesh(geometry, material)
    scene.add(sphere)

    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85))

    // --- ANIMATION LOOP ---
    const dataArray = new Uint8Array(32)
    let animationId: number

    const animate = () => {
      animationId = requestAnimationFrame(animate)

      // Use refs to access latest state without re-render
      const { isSpeaking, inputAnalyser, outputAnalyser } = stateRef.current
      let intensity = 0.2

      if (inputAnalyser || outputAnalyser) {
        let val = 0
        if (inputAnalyser) {
            inputAnalyser.getByteFrequencyData(dataArray)
            val += dataArray[4]
        }
        if (outputAnalyser) {
            outputAnalyser.getByteFrequencyData(dataArray)
            val += dataArray[4] * 1.5 
        }
        const avg = val / 255 
        if (avg > 0) intensity += avg
      }

      material.uniforms.uTime.value += 0.01
      material.uniforms.uIntensity.value = THREE.MathUtils.lerp(material.uniforms.uIntensity.value, intensity, 0.1)
      
      const targetColor = isSpeaking ? new THREE.Color("#50C878") : new THREE.Color("#2E86C1")
      material.uniforms.uColorA.value.lerp(targetColor, 0.05)

      sphere.rotation.y += 0.005
      sphere.rotation.z += 0.002

      composer.render()
    }

    animate()

    const handleResize = () => {
      if (!mountRef.current) return
      camera.aspect = mountRef.current.clientWidth / mountRef.current.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight)
      composer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(animationId)
      mountRef.current?.removeChild(renderer.domElement)
      renderer.dispose()
    }
  }, []) // Empty dependency array ensures we only init ONCE

  return <div ref={mountRef} className="w-full h-full" />
}