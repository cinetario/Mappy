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
  /** camadas ocultas pelo "olho" (prefixo do id da peça) */
  const ocultas = new Set<string>();
  const visivel = (id: string) => ![...ocultas].some((o) => id === o || id.startsWith(`${o}-`));

  let comGrade = true;
  let ultimaCaixa: THREE.Box3 | null = null;
  const DE_FRENTE = new THREE.Vector3(0, -1, 0.85).normalize();
  // um tiquinho inclinado: olhar exatamente na vertical confunde os controles de órbita
  const DE_CIMA = new THREE.Vector3(0, -0.001, 1).normalize();
  const apontar = (direcao: THREE.Vector3) => {
    if (!ultimaCaixa || ultimaCaixa.isEmpty()) return;
    const esfera = ultimaCaixa.getBoundingSphere(new THREE.Sphere());
    const meioFovV = THREE.MathUtils.degToRad(camera.fov / 2);
    const meioFov = Math.min(meioFovV, Math.atan(Math.tan(meioFovV) * camera.aspect));
    const distancia = (esfera.radius / Math.sin(meioFov)) * 1.05;
    controles.target.copy(esfera.center);
    camera.position.copy(esfera.center).addScaledVector(direcao, distancia);
    camera.near = distancia / 100;
    camera.far = distancia * 10;
    camera.updateProjectionMatrix();
  };

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
    mostrar(
      pecas: { id: string; malha: Malha; cor: string; opacidade?: number; arestas?: boolean; deslocar?: [number, number] }[],
      enquadrar = true,
      linhas?: { id: string; pontos: Float32Array[]; cor: string },
    ): number {
      for (const filho of [...grupo.children]) {
        filho.traverse((o) => {
          const m = o as THREE.Mesh;
          m.geometry?.dispose();
          (m.material as THREE.Material | undefined)?.dispose();
        });
        grupo.remove(filho);
      }
      const caixa = new THREE.Box3();
      for (const { id, malha, cor, opacidade = 1, arestas, deslocar } of pecas) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(malha.posicoes, 3));
        geo.setIndex(new THREE.BufferAttribute(malha.indices, 1));
        // prédios e ruas: faces planas (arestas nítidas); terreno: sombreado suave
        const plano = id === 'predios' || id === 'ruas';
        if (plano) {
          const solto = geo.toNonIndexed();
          solto.computeVertexNormals();
          geo.dispose();
          geo.copy(solto);
          solto.dispose();
        } else {
          geo.computeVertexNormals();
        }
        geo.computeBoundingBox();
        const caixaPeca = geo.boundingBox!.clone();
        if (deslocar) caixaPeca.translate(new THREE.Vector3(deslocar[0], deslocar[1], 0));
        caixa.union(caixaPeca);
        const material = new THREE.MeshStandardMaterial({
          color: cor, roughness: 0.85, wireframe: aramado,
          transparent: opacidade < 1, opacity: opacidade, depthWrite: opacidade >= 1,
        });
        const mesh = new THREE.Mesh(geo, material);
        mesh.name = id;
        if (deslocar) mesh.position.set(deslocar[0], deslocar[1], 0);
        mesh.visible = visivel(id);
        if (arestas) {
          const linhas = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: 0x3a3630 }));
          mesh.add(linhas);
        }
        grupo.add(mesh);
      }
      // linhas só de visualização (curvas de nível que não vão para o arquivo)
      if (linhas?.pontos.length) {
        const segmentos: number[] = [];
        for (const l of linhas.pontos) {
          for (let k = 0; k + 5 < l.length; k += 3) segmentos.push(l[k], l[k + 1], l[k + 2], l[k + 3], l[k + 4], l[k + 5]);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(segmentos, 3));
        const obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: linhas.cor }));
        obj.name = linhas.id;
        obj.visible = visivel(linhas.id);
        grupo.add(obj);
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

      grade.visible = comGrade;
      ultimaCaixa = caixa;
      if (enquadrar) apontar(DE_FRENTE);
      return quadrado;
    },
    /** volta a câmera para ver o modelo inteiro (de frente e de cima, ou só de cima) */
    enquadrar(deCima = false) {
      apontar(deCima ? DE_CIMA : DE_FRENTE);
    },
    definirGrade(ligada: boolean) {
      comGrade = ligada;
      if (grade) grade.visible = ligada;
    },
    definirAramado(ligado: boolean) {
      aramado = ligado;
      for (const filho of grupo.children) ((filho as THREE.Mesh).material as THREE.MeshStandardMaterial).wireframe = ligado;
    },
    /** "olho" da camada: oculta só na visualização */
    definirOculta(id: string, oculta: boolean) {
      if (oculta) ocultas.add(id);
      else ocultas.delete(id);
      for (const filho of grupo.children) filho.visible = visivel(filho.name);
    },
  };
}
