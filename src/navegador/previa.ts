// Pré-visualização 3D interativa (Three.js). Arraste para girar, roda do mouse para zoom.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Malha } from '../core/malha.ts';

export const CORES_CAMADAS = {
  terreno: 0xc9b98f,
};

export function criarPrevia(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.appendChild(renderer.domElement);

  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
  camera.up.set(0, 0, 1); // eixo Z para cima, como na impressora
  camera.position.set(0, -260, 200);

  cena.add(new THREE.HemisphereLight(0xffffff, 0x8a8170, 1.6));
  const sol = new THREE.DirectionalLight(0xffffff, 2.2);
  sol.position.set(-150, -100, 250);
  cena.add(sol);

  const controles = new OrbitControls(camera, renderer.domElement);
  controles.enableDamping = true;

  const grupo = new THREE.Group();
  cena.add(grupo);

  const redimensionar = () => {
    const { clientWidth: w, clientHeight: h } = container;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(redimensionar).observe(container);
  redimensionar();

  renderer.setAnimationLoop(() => {
    controles.update();
    renderer.render(cena, camera);
  });

  return {
    /** `enquadrar`: reposiciona a câmera (use quando a área muda). */
    mostrar(camadas: { malha: Malha; cor: number }[], enquadrar = true) {
      for (const filho of [...grupo.children]) {
        const m = filho as THREE.Mesh;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        grupo.remove(m);
      }
      const caixa = new THREE.Box3();
      for (const { malha, cor } of camadas) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(malha.posicoes, 3));
        geo.setIndex(new THREE.BufferAttribute(malha.indices, 1));
        geo.computeVertexNormals();
        geo.computeBoundingBox();
        caixa.union(geo.boundingBox!);
        grupo.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cor, roughness: 0.85 })));
      }
      if (!enquadrar) return;
      // enquadra o modelo inteiro, visto de frente e de cima
      const esfera = caixa.getBoundingSphere(new THREE.Sphere());
      // o campo de visão da câmera é vertical; em telas estreitas o horizontal é menor
      const meioFovV = THREE.MathUtils.degToRad(camera.fov / 2);
      const meioFov = Math.min(meioFovV, Math.atan(Math.tan(meioFovV) * camera.aspect));
      const distancia = (esfera.radius / Math.sin(meioFov)) * 1.05;
      const direcao = new THREE.Vector3(0, -1, 0.85).normalize();
      controles.target.copy(esfera.center);
      camera.position.copy(esfera.center).addScaledVector(direcao, distancia);
      camera.near = distancia / 100;
      camera.far = distancia * 10;
      camera.updateProjectionMatrix();
    },
  };
}
