# Relevo3D

Aplicativo local (roda no seu PC, pelo navegador) que gera modelos 3D de mapas de
qualquer lugar do mundo e exporta para impressão 3D.

> **Fase atual: A**: seleção em retângulo, círculo, hexágono ou polígono (a base
> do modelo sai no mesmo formato), terreno, exportação STL e estado salvo na URL.
> Próximas fases: B (aba Modelo) → C (prédios, ruas, água) → D (cobertura do
> solo, árvores, curvas de nível) → E (moldura, texto, blocos, 3MF multicor).

---

## 1. Instalação (só na primeira vez)

### 1.1 Node.js
O projeto precisa do Node.js (versão 20 ou mais nova). Abra o **PowerShell** e rode:

```powershell
winget install OpenJS.NodeJS.LTS
```

Feche e abra o PowerShell de novo e confira:

```powershell
node --version
```

### 1.2 Dependências do projeto

```powershell
cd C:\caminho\para\Mappy
npm install
```

Isso baixa as bibliotecas (MapLibre, Three.js, manifold-3d…) para a pasta `node_modules`.

> **Erro "a execução de scripts foi desabilitada neste sistema"?** O PowerShell
> bloqueia o `npm` por padrão. Use `npm.cmd` no lugar de `npm` (ex.: `npm.cmd install`)
> ou libere uma vez com:
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

---

## 2. Rodando o app

```powershell
cd C:\caminho\para\Mappy
npm run dev
```

O navegador abre sozinho em **http://localhost:5173**. Para parar, volte ao
PowerShell e aperte `Ctrl + C`.

## 3. Como usar

1. **Local**: digite um endereço, cidade ou montanha e clique em *Buscar*. Clique num
   resultado para o mapa ir até lá.
2. **Área**: escolha uma forma na barra sobre o mapa. A base do modelo sai
   no mesmo formato.
   - **Retângulo**: clique e arraste.
   - **Círculo / Hexágono**: clique no centro e arraste para fora.
   - **Polígono**: clique ponto a ponto. Para fechar, clique no primeiro ponto,
     dê duplo clique ou aperte Enter. Backspace desfaz o último ponto.
   - **Cancelar** (ou Esc) desiste do desenho e volta à área anterior.

   Depois de desenhar, **arraste as alças brancas** para ajustar:
   - cantos e vértices mudam a forma;
   - a alça verde do centro move tudo;
   - no hexágono, a alça do vértice muda o tamanho e gira;
   - no polígono, arrastar a bolinha do meio de um lado cria um vértice novo,
     e o botão direito sobre um vértice o apaga.

   O painel mostra o tamanho real, a área (km²) e a escala do modelo.
   Se o modelo já foi gerado, ajustar a área atualiza a pré-visualização.
3. **Modelo**:
   - *Tamanho do lado maior*: em mm (a Snapmaker U1 imprime até 270 mm).
   - *Exagero vertical*: 1x é a escala real. Áreas planas ou grandes ficam
     melhores com 2x a 4x.
   - *Espessura da base*: quanto de material fica abaixo do ponto mais baixo.
   - *Detalhe*: número de pontos no lado maior. 300 é um bom padrão; acima de
     ~400 só ajuda em áreas pequenas, porque os dados de elevação têm limite de
     resolução (veja a seção 6).
   - *Mar plano*: transforma o fundo do oceano em superfície plana no nível 0.
4. Clique em **Gerar modelo 3D**. A pré-visualização aparece à direita
   (arraste para girar, roda do mouse para zoom, botão direito para mover).
   Depois de gerado, mudar os parâmetros atualiza a prévia na hora.
5. A linha de status mostra **✓ Malha fechada e válida** quando o modelo passou na
   verificação. Clique em **Baixar STL**.

**Salvar e compartilhar:** a área e todos os parâmetros ficam no endereço da
página (a parte depois do `#`). Copie a URL para guardar um modelo ou mandar
para alguém. Ao abrir o link, o modelo é refeito igualzinho. Recarregar a página
(F5) também não perde nada.

## 4. Imprimindo (Snapmaker Orca)

1. Abra o Snapmaker Orca e arraste o arquivo `.stl` para a mesa.
2. O modelo já vem com a base para baixo, em milímetros, sem precisar girar.
3. Sugestões para um primeiro teste:
   - Tamanho 100 mm a 150 mm, exagero 1,5x a 2x.
   - Camada de 0,2 mm (ou 0,12 mm para relevo mais suave).
   - Preenchimento de 10 % a 15 %: o modelo é sólido, e preencher tudo gasta muito filamento.
   - Sem suportes: o relevo não tem partes no ar.

## 5. Verificar se um STL é válido (manifold)

Qualquer STL, inclusive os baixados pelo app, pode ser conferido com:

```powershell
npm run verificar -- "C:\caminho\para\pao-de-acucar-150mm.stl"
```

O comando confere se a malha é fechada (cada aresta liga exatamente 2 triângulos),
se não tem faces invertidas nem triângulos degenerados, e valida com a biblioteca
**manifold-3d**.

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm test` | Roda os testes automáticos (inclusive o de malha manifold) |
| `npm run exemplo` | Gera um STL do Pão de Açúcar em `saida\` sem abrir o navegador. Aceita `-- circulo`, `-- hexagono` ou um trecho copiado da URL do app, ex.: `-- "#a=c:-43.16,-22.95,1500&t=120"` |
| `npm run typecheck` | Confere os tipos do TypeScript |

## 6. Dados, cache e limites

| Dado | Fonte | Licença |
|---|---|---|
| Elevação | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (formato Terrarium) | Aberta, uso comercial permitido com atribuição |
| Mapa de fundo | [OpenFreeMap](https://openfreemap.org) | Grátis, sem chave |
| Busca de endereços | [Nominatim](https://nominatim.org) / OpenStreetMap | ODbL |

- **Atribuição obrigatória:** "© OpenStreetMap contributors" aparece no app. Se
  vender ou divulgar as impressões, inclua essa frase (por exemplo, numa etiqueta).
  Os dados de elevação combinam SRTM, GMTED2010, ETOPO1 e outras fontes públicas;
  veja os créditos completos em
  [github.com/tilezen/joerd](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
- **Cache:** tudo que é baixado fica em `mapas3d\cache\`. Gerar de novo a mesma
  área não acessa a internet. Pode apagar essa pasta a qualquer momento.
- **Busca:** limitada a 1 pedido por segundo, como pede a política do Nominatim.
  Para incluir seu e-mail de contato no pedido (recomendado pela política), rode
  antes do `npm run dev`:
  `$env:RELEVO3D_CONTATO = "seu@email.com"`
- **Resolução dos dados de elevação:** cerca de 30 m na maior parte do mundo. Picos
  muito finos saem mais baixos que na realidade. Exemplo: o Pão de Açúcar (396 m)
  aparece com ~304 m. Por isso, áreas de 2 a 20 km de lado costumam dar o melhor resultado.
- **Áreas grandes:** acima de ~25 km² o app avisa. Na fase 2 o serviço de
  prédios e ruas (Overpass) fica lento ou recusa áreas grandes; para só o relevo,
  tudo bem.

## 7. Estrutura do projeto

```
mapas3d/
  index.html            página do app
  src/
    main.ts             liga a interface aos módulos
    estilo.css
    core/               lógica pura (funciona no navegador e no Node)
      geo.ts            formas de seleção, medidas em metros, projeção, tiles
      estado.ts         definição dos parâmetros + leitura/escrita na URL
      elevacao.ts       leitura dos tiles Terrarium e amostragem da grade
      terreno.ts        grade → bloco sólido (topo, paredes, fundo)
      modelo.ts         recorta o bloco no formato da área (manifold-3d)
      verificacao.ts    verificação de malha manifold
      manifold.ts       ponte com a biblioteca manifold-3d (booleanas e validação)
      stl.ts            leitura e escrita de STL binário
    navegador/          partes que só rodam no navegador
      mapa.ts           MapLibre e mapa de fundo
      desenho.ts        ferramentas de desenho e alças de edição
      gerador.ts        conversa com o Web Worker
      previa.ts         pré-visualização 3D (Three.js)
      tiles.ts          baixa tiles pelo servidor local
    trabalhador/        Web Worker: gera o modelo sem travar a tela
  server/               servidor local (embutido no Vite) com cache em disco
  scripts/              comandos verificar e exemplo
  tests/                testes automáticos (Vitest)
```
