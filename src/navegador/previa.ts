// Pré-visualização 3D interativa (Three.js). Arraste para girar, roda do mouse para zoom.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Malha } from '../core/malha.ts';

/** Tamanho "redondo" do quadrado da grade para ~10–25 quadrados no lado maior. */
export function tamanhoQuadrado(ladoMaior: number): number {
  const opcoes = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  return opcoes.find((s) => ladoMaior / s <= 25) ?? opcoes[opcoes.length - 1];
}

export function criarPrevia(container: HTMLElement) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  container.prepend(renderer.domElement);

  const cena = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
  camera.up.set(0, 0, 1); // eixo Z para cima, como na impressora

  cena.add(new THREE.HemisphereLight(0xffffff, 0x8a8170, 1.6));
  const sol = new THREE.DirectionalLight(0xffffff, 2.2);
  sol.position.set(-150, -100, 250);
  cena.add(sol);

  const controles = new OrbitControls(camera, renderer.domElement);
  controles.enableDamping = true;

  const grupo = new THREE.Group();
  cena.add(grupo);
  let grade: THREE.GridHelper | null = null;
  let aramado = false;

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
    /**
     * Mostra as peças. `enquadrar` reposiciona a câmera (use quando a área muda).
     * Devolve o tamanho do quadrado da grade do chão.
     */
    mostrar(pecas: { malha: Malha; cor: string }[], enquadrar = true): number {
      for (const filho of [...grupo.children]) {
        const m = filho as THREE.Mesh;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
        grupo.remove(m);
      }
      const caixa = new THREE.Box3();
      for (const { malha, cor } of pecas) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(malha.posicoes, 3));
        geo.setIndex(new THREE.BufferAttribute(malha.indices, 1));
        geo.computeVertexNormals();
        geo.computeBoundingBox();
        caixa.union(geo.boundingBox!);
        const material = new THREE.MeshStandardMaterial({ color: cor, roughness: 0.85, wireframe: aramado, flatShading: false });
        grupo.add(new THREE.Mesh(geo, material));
      }

      // grade de referência no chão
      const tam = caixa.getSize(new THREE.Vector3());
      const lado = Math.max(tam.x, tam.y);
      const quadrado = tamanhoQuadrado(lado);
      if (grade) {
        cena.remove(grade);
        grade.geometry.dispose();
        (grade.material as THREE.Material).dispose();
      }
      const divisoes = Math.ceil(lado / quadrado) + 4;
      grade = new THREE.GridHelper(divisoes * quadrado, divisoes, 0x7a8a90, 0xa9b6bb);
      grade.rotation.x = Math.PI / 2; // GridHelper nasce no plano XZ
      grade.position.z = -lado * 0.001;
      cena.add(grade);

      if (enquadrar) {
        // enquadra o modelo inteiro, visto de frente e de cima
        const esfera = caixa.getBoundingSphere(new THREE.Sphere());
        const meioFovV = THREE.MathUtils.degToRad(camera.fov / 2);
        const meioFov = Math.min(meioFovV, Math.atan(Math.tan(meioFovV) * camera.aspect));
        const distancia = (esfera.radius / Math.sin(meioFov)) * 1.05;
        const direcao = new THREE.Vector3(0, -1, 0.85).normalize();
        controles.target.copy(esfera.center);
        camera.position.copy(esfera.center).addScaledVector(direcao, distancia);
        camera.near = distancia / 100;
        camera.far = distancia * 10;
        camera.updateProjectionMatrix();
      }
      return quadrado;
    },
    definirAramado(ligado: boolean) {
      aramado = ligado;
      for (const filho of grupo.children) ((filho as THREE.Mesh).material as THREE.MeshStandardMaterial).wireframe = ligado;
    },
  };
}
