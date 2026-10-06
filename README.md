# Relevo3D

Aplicativo local (roda no seu PC, pelo navegador) que gera modelos 3D de mapas de
qualquer lugar do mundo e exporta para impressão 3D.

Feito para a **Snapmaker U1** (4 filamentos) com o **Snapmaker Orca**, usando só
dados abertos e gratuitos (sem chaves de API pagas).

> **Fase atual: F.** Já funciona:
> - seleção em retângulo, círculo, hexágono ou polígono (a base sai no mesmo formato);
> - aba Modelo com pontos de partida, 3 fontes de elevação e malha adaptativa;
> - faixas de cor por altitude alinhadas às camadas de impressão;
> - aba Camadas com **prédios, ruas, água, cobertura do solo, árvores e curvas de nível**;
> - prédios do **OpenStreetMap, Overture Maps ou arquivo da prefeitura**, com telhados;
> - dados do OpenStreetMap de um **arquivo local** (ou do Overpass);
> - **moldura com texto** e **divisão em blocos** para mapas maiores que a mesa;
> - exportação **3MF multicolor** (uma peça por camada, com filamento definido),
>   STL único e STL por peça;
> - estado salvo na URL (copie o link para guardar ou compartilhar um modelo).

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

### 1.3 Dados do OpenStreetMap no seu PC (recomendado)

Prédios, ruas, água, cobertura do solo e árvores podem vir de um **arquivo
local**, sem depender do Overpass (que vive sobrecarregado).

1. Baixe o extrato da sua região na Geofabrik. Para o Sudeste:
   https://download.geofabrik.de/south-america/brazil/sudeste-latest.osm.pbf (~820 MB).
   Outras regiões: download.geofabrik.de/south-america/brazil.html
   (o **Distrito Federal** está no arquivo do **Centro-Oeste**, ~200 MB).
2. Salve o arquivo na pasta `C:\caminho\para\Mappy\dados-osm\`.
   Pode colocar **um arquivo por região** (ex.: Sudeste e Centro-Oeste juntos);
   todos são importados. O nome pode ser o `-latest` ou o com data
   (`sudeste-261005.osm.pbf`).
3. Rode:
   ```powershell
   npm run importar-osm
   ```
   Gera `dados-osm\indice-osm.sqlite`. Com Sudeste + Centro-Oeste leva ~12
   minutos e o índice fica com ~12 GB. Dá para rodar com o app aberto; depois
   aperte F5.

**Para atualizar** os dados: baixe o arquivo novo da região e rode
`npm run importar-osm` de novo. A aba **Camadas** mostra a data dos dados e
quando foram importados.

> **Atenção:** deixe só **um arquivo de cada região** na pasta. Se o novo tiver
> outro nome (ex.: `sudeste-261005` ao lado de `sudeste-261004`), apague o
> antigo antes de importar; senão os dados daquela região entram em dobro.

Na aba Camadas, **Fonte dos dados OSM** escolhe entre *Arquivo local* (padrão)
e *Overpass (online)*. Se a área desenhada ficar fora do arquivo importado (ex.:
outro estado), o app usa o Overpass automaticamente e avisa.

A pasta `dados-osm\` não vai para o Git.

### 1.4 Prédios de outras fontes (opcional)

Ficam no mesmo índice local (`dados-osm\indice-osm.sqlite`) e continuam lá quando
você roda `npm run importar-osm` de novo.

**Overture Maps** (mais prédios no Brasil, de Google, Microsoft e Esri, além do OSM):
```powershell
npm run importar-overture -- df
```
Baixa só os pedaços dos arquivos do Overture que tocam a região (o DF dá ~210 MB
de download). Outras regiões: passe a caixa em graus, `oeste,sul,leste,norte`,
ex.: `npm run importar-overture -- -43.8,-23.1,-43.1,-22.7`. Rodar de novo
troca os dados daquela região pela versão mais nova do Overture.

**Arquivo da prefeitura** (GeoJSON, shapefile em `.zip` ou `.shp` com `.dbf` e `.prj`):
```powershell
npm run importar-predios -- "C:\caminho\edificacoes.zip"
```
Sem mais opções, o comando lista os campos do arquivo e sugere qual parece ser
a altura. Depois importe dizendo o campo e o texto de atribuição exigido pela
licença do arquivo:
```powershell
npm run importar-predios -- "C:\caminho\edificacoes.zip" --altura ALTURA --atribuicao "Prefeitura de X (licença Y)"
```
- `--andares CAMPO` usa o número de andares (3 m cada) no lugar da altura.
- As coordenadas são convertidas pelo `.prj` (ou pelo `crs` do GeoJSON). Se o
  arquivo não disser o sistema, use `--epsg`: SIRGAS 2000 / UTM 23S (DF, MG, RJ,
  SP leste) é `--epsg 31983`; 22S é `31982`; 24S é `31984`.
- `--nome` dá um nome curto ao conjunto (reimportar com o mesmo nome substitui).

---

## 2. Rodando o app

```powershell
cd C:\caminho\para\Mappy
npm run dev
```

O navegador abre sozinho em **http://localhost:5173**. Para parar, volte ao
PowerShell e aperte `Ctrl + C`.

**Depois de atualizar o projeto** (`git pull` ou uma fase nova): pare o app,
rode `npm install` (pode ter biblioteca nova) e `npm run dev` de novo. No
navegador, `Ctrl + F5` recarrega sem cache.

> **Cores estranhas, tudo escuro?** Extensões de "modo escuro" do navegador
> (como a Dark Reader) escurecem o app. Desligue a extensão para `localhost`.

## 3. Como usar

A tela tem três partes:
- **Barra de cima**: busca de lugares e os botões **Mapa**, **Lado a lado** e
  **3D**, que escolhem o que aparece no meio da tela. A escolha fica guardada
  no navegador.
- **Meio**: o mapa (para escolher a área) e/ou a visualização 3D.
- **Painel da direita**: pontos de partida, abas *Modelo* e *Camadas* e, no
  rodapé, cores, botão de gerar, status e downloads.

1. **Local**: digite um endereço, cidade ou montanha na busca da barra de cima
   e aperte Enter. Clique num resultado para o mapa ir até lá.
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

   Um cartão no canto do mapa mostra o tamanho real, a área (km²) e a escala do modelo.
   Se o modelo já foi gerado, ajustar a área atualiza a pré-visualização.
3. **Pontos de partida** (cartões no topo do painel): configuração rápida.
   - **Só terreno**: uma cor, exagero 1,5x.
   - **Topográfico**: faixas de cor por altitude, exagero 2x.
   - **Impressão 3D**: 220 mm, altura travada em 17 mm, base de 2 mm, camadas de 0,2 mm.
   - **Redefinir**: volta tudo ao padrão (a área continua).
4. **Aba Modelo**: seções que abrem uma de cada vez.
   - **Dimensões e coordenadas**
     - *Impressão 3D* (em mm) ou *Escala 1:1* (em metros reais, para Blender/GIS).
     - Tamanho do maior lado (padrão 220 mm; a U1 imprime até 270 mm).
     - *Travar altura total*: o exagero é calculado para o ponto mais alto ficar
       na altura pedida.
     - Unidades métricas ou imperiais (só na tela; os arquivos são sempre em mm).
     - *Dividir em blocos*: corta o modelo em colunas × linhas (até 8 × 8) para
       imprimir mapas maiores que a mesa. Cada bloco vira um arquivo, com nome
       A1, B1… (letra = coluna de oeste para leste, número = linha; A1 é o canto
       noroeste). O painel mostra o tamanho de cada bloco e se cabe na mesa. Na
       pré-visualização os blocos aparecem afastados, para ver os cortes.
   - **Detalhes do terreno**
     - Exagero vertical.
     - Fonte de elevação (veja a seção 6), com a resolução real usada no modelo.
     - Zoom dos tiles (Automático escolhe sozinho).
     - Pontos no lado maior.
     - *Simplificação*: triangulação adaptativa que usa muitos triângulos onde o
       relevo muda e poucos onde é plano. Com 0,05 mm, a malha costuma ficar 5 a
       10 vezes menor sem diferença visível. 0 desliga.
     - Mar plano.
   - **Estilo do terreno**
     - Cor sólida ou *faixas por altitude*: lista editável de "% da altura : cor".
     - Cada faixa vira uma **peça separada**, cortada exatamente numa altura de
       camada, para trocar de filamento sem degraus.
   - **Base**: altura abaixo do ponto mais baixo (padrão 2 mm), arredondada
     para um número inteiro de camadas.
   - **Laterais**: cor da base (que é uma peça separada).
   - **Moldura e texto**
     - Moldura em volta do modelo (em qualquer formato de área): cantos retos ou
       arredondados, cor, espessura (padrão 3 mm) e altura a partir da mesa
       (padrão 5 mm). *Fundir à base* junta a moldura à base (mesma peça e cor).
     - Texto (até 60 letras) numa plaquinha da moldura, embaixo, em cima ou nas
       laterais. Três fontes livres (Archivo Black, Bebas Neue, Anton), altura das
       letras (padrão 6 mm) e cor.
     - *Em relevo*: as letras sobem acima da moldura (padrão 0,8 mm).
       *Embutido*: as letras ficam no nível da moldura, só com outra cor.
     - Moldura e texto são peças separadas, com a altura alinhada às camadas.
   - **Camadas de impressão**: altura de camada e da 1ª camada. Use os mesmos
     valores do perfil no Snapmaker Orca.
   - **Estatísticas**: triângulos, peças e tamanho estimado dos arquivos.
5. Clique em **Gerar modelo 3D**. A visualização 3D aparece no meio da tela
   (arraste para girar, roda do mouse para zoom, botão direito para mover).
   - A caixa no canto mostra as dimensões finais, a escala (1:N), o exagero
     usado e o tamanho dos quadrados da grade do chão.
   - Botões no canto da visualização: **enquadrar** o modelo, **ver de cima**,
     **malha** (mostra os triângulos) e **grade** do chão.
   - Na aba Camadas, cada camada tem um ícone com a cor dela, o **olho**
     (esconde só na visualização) e o interruptor que liga ou desliga.
   - Depois de gerado, mudar os parâmetros atualiza a prévia na hora.
6. A linha de status mostra **✓ Malha fechada e válida** quando todas as peças
   passaram na verificação. Escolha o arquivo:
   - **Baixar 3MF multicolor**: cada camada é um objeto separado e com nome
     (Base, Terreno, Prédios, Ruas, Água, Moldura, Texto…), já com a cor e o
     filamento definidos. Abre como um objeto só, com as peças no lugar certo.
   - **STL único**: todas as peças fundidas num sólido só (uma cor).
   - **STL por peça (.zip)**: um STL por camada, todos alinhados na mesma origem.
   - Com *Dividir em blocos* ligado, cada botão baixa um `.zip` com um arquivo
     por bloco (no STL por peça, uma pasta por bloco).

   Abaixo dos botões aparece **qual peça vai em qual filamento** (1 a 4). A
   Snapmaker U1 tem 4 filamentos: as 4 cores com mais volume ganham um filamento
   cada, e as outras vão para o filamento de cor mais parecida (verde com verde,
   por exemplo). Dá para trocar no Snapmaker Orca.

### Aba Camadas

Cada camada tem um **interruptor** (liga/desliga no arquivo), a **quantidade** de
elementos e um **olho** (esconde só na pré-visualização; continua no arquivo).
Clique no nome para abrir as opções.

- **Prédios**: altura vinda de `height` / `building:levels` (3 m por
  andar), com altura padrão para os que não têm essa informação.
  - *Fonte dos prédios* (veja a seção 1.4 para importar):
    - **OpenStreetMap**: o padrão.
    - **Overture Maps**: junta OSM, Google Open Buildings, Microsoft e Esri;
      cobre muito mais prédios no Brasil, alguns com altura.
    - **Automático**: OSM onde houver; o Overture completa a altura dos prédios
      do OSM sem altura e acrescenta os que faltam, sem duplicar (se um prédio
      do Overture cobre 30% ou mais de um do OSM, ou o contrário, é o mesmo).
    - **Arquivo da prefeitura**: GeoJSON ou shapefile que você importar.
  - O painel mostra quantos prédios vieram de cada fonte (e, no Overture, de
    cada base original), quantos estão sem altura (usam o padrão) e, no
    Automático, quantos ganharam altura do Overture.
  - *Prédios detalhados* usa `building:part` quando existir. Partes que começam
    no alto (`min_height`, como passarelas): *Preencher embaixo* (padrão, imprime
    sem suporte) ou *Deixar o vão* (precisa de suporte).
  - *Telhados*: desenha `roof:shape` do OSM (duas águas, quatro águas,
    piramidal, cúpula; plano é o normal), com a altura de `roof:height` ou
    `roof:levels` (sem isso: inclinação de 30°). O telhado é feito sobre o
    retângulo que envolve o prédio e cortado no contorno dele. Em escala de
    cidade um telhado de 3 m vira décimos de mm; aparece bem em bairros.
  - Exagero de altura e aleatoriedade (sempre igual para o mesmo prédio).
  - Mostra o prédio mais baixo e o mais alto, em mm e em metros reais.
  - *Elevado* (sobre o terreno) ou *Rebaixado* (encaixado num sulco).
  - Deslocamento vertical, cor e arestas (só na visualização).
  - O telhado de cada prédio cai exatamente numa altura de camada.
- **Ruas**: *Superfície* (embutida, rente ao terreno) ou *Extrudada*, com
  integração *Elevada* ou *Rebaixada*, mais altura, profundidade e deslocamento.
  - A altura também aparece em metros reais.
  - Escala de largura.
  - Em *Tipos de via e larguras* dá para ligar/desligar cada tipo e ver a
    largura real e a impressa. Abaixo de 0,8 mm, a via é engrossada.
  - Túneis vêm desligados.
- **Água**: lagos, represas, rios (em área e em linha) e **mar**, montado a
  partir das linhas de costa.
  - Lagos e mar ficam **planos**, numa altura de camada; rios em declive
    acompanham o terreno.
  - A profundidade do rebaixo é limitada para deixar 0,2 mm de base, e o app avisa.
  - *Avançado*: ocultar corpos d'água pequenos, por largura e área mínimas.
- **Cobertura do solo** (desligada por padrão): Floresta, Grama, Lavoura, Área
  úmida, Areia, Gelo, Rocha e Urbano, a partir de `landuse` / `natural` /
  `leisure` do OSM.
  - Cada categoria vira **uma peça com a própria cor**.
  - Em *Categorias (avançado)*: liga/desliga, cor, altura e elevada/rebaixada
    de cada uma. Urbano e Gelo vêm desligados.
  - Modo superfície (rente ao terreno) ou extrudada, deslocamento vertical e
    opacidade (só na tela).
  - Áreas menores que a *área mínima* somem, para não virar pontinhos de cor.
- **Árvores** (desligadas por padrão):
  - Fontes, que dá para combinar: árvores mapeadas no OSM (`natural=tree` e
    fileiras `tree_row`) e florestas preenchidas com árvores geradas (sempre
    iguais para a mesma área).
  - Estilos: *Só copa* (padrão, melhor para imprimir), *Só copa low-poly*,
    *Clássica* (tronco + copa) e *Clássica low-poly*. O tronco da clássica é
    fino para o bico de 0,4 mm.
  - Densidade (árvores por cm²) com a contagem, tamanho em mm e em metros
    reais. A copa nunca fica abaixo de 0,8 mm.
  - *Distância de segurança*: afasta as copas de ruas, prédios e água.
  - Limite de quantidade (padrão 4.000), para não travar.
- **Curvas de nível** (desligadas por padrão; o preset Topográfico liga):
  - Intervalo em metros, ou 0 para automático (~15 linhas). O painel mostra
    a faixa de altitudes, por exemplo "1070 m → 1170 m".
  - *Imprimir como linhas em relevo baixo*: as curvas viram uma peça (altura
    e largura ajustáveis). Desligado, aparecem só na visualização.
  - Não passam por cima da água.

**Prioridade entre camadas** (a de cima recorta as de baixo, nada se sobrepõe):
prédios > ruas > água > árvores > curvas de nível > cobertura do solo > terreno.

**Tamanho da área e camadas:** prédios e ruas ficam em *automático*: ligados até
100 km², desligados acima disso. Dá para ligar manualmente, com aviso; "Voltar ao
automático" desfaz. Acima de 25 km² aparece o atalho **Só vias principais**.

**Muitos elementos:** se a área tiver mais de 15 mil prédios ou 15 mil ruas, o
app mostra a contagem antes de montar o modelo e oferece: gerar mesmo assim,
desligar prédios ou ficar só com as vias principais.

**Sem sobreposição:** prédios têm prioridade sobre ruas, e ruas sobre água (uma
ponte corta o rio). Cada peça é um sólido fechado separado, que vira um objeto
próprio no 3MF multicolor.

**Contador de cores:** acima dos botões aparece "Cores: N/4". Antes de gerar,
ele conta as cores das camadas ligadas; depois, só as das peças que saíram de
verdade. A Snapmaker U1 tem 4 filamentos; se passar disso, o app avisa. Com a
cobertura do solo ligada passa fácil de 4: use a mesma cor em categorias
parecidas (ex.: floresta e grama em verde) ou desligue as que não importam.

**Salvar e compartilhar:** a área e todos os parâmetros ficam no endereço da
página (a parte depois do `#`). Copie a URL para guardar um modelo ou mandar
para alguém. Ao abrir o link, o modelo é refeito igualzinho. Recarregar a página
(F5) também não perde nada.

## 4. Imprimindo (Snapmaker Orca)

1. Abra o Snapmaker Orca e arraste o arquivo `.3mf` para a mesa.
   - Se perguntar *"carregar como um objeto com várias peças?"*, responda **Sim**.
   - Na lista de objetos (à esquerda), abra o objeto: cada peça aparece com o
     nome e o número do filamento. Confira as cores dos filamentos 1 a 4 no
     painel de filamentos para elas baterem com o painel do app.
   - Com o `.stl` único, o modelo sai numa cor só.
2. O modelo já vem com a base para baixo, em milímetros, sem precisar girar.
3. Sugestões para um primeiro teste:
   - Tamanho 100 mm a 150 mm, exagero 1,5x a 2x.
   - Camada de 0,2 mm (ou 0,12 mm para relevo mais suave).
   - Preenchimento de 10 % a 15 %: o modelo é sólido, e preencher tudo gasta muito filamento.
   - Sem suportes: o relevo não tem partes no ar. A exceção são os prédios com
     *Deixar o vão* (partes com `min_height`); no padrão eles saem preenchidos.
4. **Blocos:** cada arquivo de bloco já vem na posição certa em relação aos
   outros. Imprima um por vez e junte pela ordem do nome (A1 no canto noroeste,
   B1 à direita dele, A2 abaixo).

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
| `npm run exemplo` | Gera um STL do Pão de Açúcar em `saida\` sem abrir o navegador. Aceita `-- circulo`, `-- hexagono` ou pedaços da URL do app separados por **espaço** (o Windows não aceita `&` aqui), ex.: `npm run exemplo -- a=c:-43.16,-22.95,1500 t=120 f=copernicus` |
| `npm run typecheck` | Confere os tipos do TypeScript |
| `npm run importar-osm` | Importa os `.osm.pbf` de `dados-osm\` para o índice local |
| `npm run pre-carregar -- df` | Guarda no cache a elevação (Mapterhorn) e o mapa de fundo do Distrito Federal. Aceita também uma caixa `oeste,sul,leste,norte` em graus, ex.: `npm run pre-carregar -- -43.8,-23.1,-43.1,-22.7` |
| `npm run importar-overture -- df` | Importa os prédios do Overture Maps de uma região para o índice local (seção 1.4) |
| `npm run importar-predios -- arquivo` | Importa prédios de um arquivo da prefeitura (seção 1.4) |

## 6. Dados, cache e limites

| Dado | Fonte | Resolução | Licença |
|---|---|---|---|
| Elevação (padrão) | [Mapterhorn](https://mapterhorn.com) | ~30 m no mundo; até 1 m em vários países | Fontes abertas com atribuição ([lista](https://mapterhorn.com/attribution)) |
| Elevação | [Copernicus DEM GLO-30](https://registry.opendata.aws/copernicus-dem/) | ~30 m | Grátis com atribuição obrigatória (aparece no rodapé do app) |
| Elevação | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium) | ~30–90 m | Aberta, com atribuição |
| Mapa de fundo | [OpenFreeMap](https://openfreemap.org) | — | Grátis, sem chave |
| Busca de endereços | [Nominatim](https://nominatim.org) / OpenStreetMap | — | ODbL |
| Prédios (opcional) | [Overture Maps](https://docs.overturemaps.org/attribution/), tema buildings | — | ODbL 1.0. Bases: OpenStreetMap (ODbL), Google Open Buildings (CC BY 4.0 / ODbL), Microsoft ML Buildings (ODbL), Esri Community Maps (CC BY 4.0) |
| Prédios (opcional) | Arquivo da prefeitura | — | A licença do arquivo (você informa o texto de atribuição na importação) |

- **Atribuição obrigatória:** o rodapé do app mostra "© OpenStreetMap contributors"
  e o crédito da fonte de elevação escolhida. Quando o modelo usa prédios do
  Overture ou da prefeitura, o rodapé acrescenta "© Overture Maps Foundation" e
  só as bases que de fato entraram no modelo (ou o texto da prefeitura). Se vender ou divulgar as impressões,
  inclua esses créditos (por exemplo, numa etiqueta).
  - Créditos do Terrain Tiles:
    [github.com/tilezen/joerd](https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
- **Mapterhorn fora da Europa:** em muitos lugares só existem tiles até o zoom 12
  (~20 m por pixel). O app usa automaticamente o maior zoom disponível e mostra
  qual foi usado.
- **Copernicus mede a superfície:** inclui prédios e copas de árvores. Em cidades,
  prefira o Mapterhorn. A primeira geração numa região leva alguns segundos, porque
  o app baixa só os pedaços necessários de arquivos de ~46 MB.
- **Cache:** tudo que é baixado fica em `mapas3d\cache\`. Gerar de novo a mesma
  área não acessa a internet. Pode apagar essa pasta a qualquer momento.
- **Pré-carregar uma região** (`npm run pre-carregar -- df`): guarda de uma vez
  a elevação do Mapterhorn e o mapa de fundo. No Brasil o Mapterhorn só tem
  dados até o zoom 12 (~30 m); o comando anota também os zooms sem dados, para
  o app não perguntar de novo. O Copernicus não entra: ele é guardado por
  modelo gerado.
- **Busca:** limitada a 1 pedido por segundo, como pede a política do Nominatim.
  Para incluir seu e-mail de contato no pedido (recomendado pela política), rode
  antes do `npm run dev`:
  `$env:RELEVO3D_CONTATO = "seu@email.com"`
- **Resolução dos dados de elevação:** cerca de 30 m na maior parte do mundo. Picos
  muito finos saem mais baixos que na realidade. Exemplo: o Pão de Açúcar (396 m)
  aparece com ~304 m. Por isso, áreas de 2 a 20 km de lado costumam dar o melhor resultado.
- **Tamanho da área:**
  - até 25 km²: tudo liberado;
  - de 25 a 100 km²: o app avisa que fica lento e que ruas locais saem finas
    demais (sugere só vias principais, água e cobertura do solo);
  - acima de 100 km²: prédios e ruas ficam desligados por padrão.
- **Largura da rua local:** o painel da área mostra quanto uma rua de 4 m mede
  impressa. Abaixo de 0,8 mm (2 linhas do bico de 0,4 mm), ela é engrossada.
- **Mapa de fundo:** estilo, tiles, fontes e ícones da OpenFreeMap passam pelo
  servidor local e ficam em `cache\mapa\`. Recarregar a página não baixa de
  novo, e áreas já vistas aparecem mesmo sem internet. Os tiles nunca expiram
  (o endereço já tem a versão); o estilo é renovado uma vez por dia.
- **Arquivo local do OSM:** o app usa o arquivo só se ele tiver dados para
  **todos** os blocos da área. A cobertura é registrada na importação; o mar
  até ~9 km da costa conta como coberto.
- **OpenStreetMap (Overpass):**
  - A área é baixada em blocos de 0,04° (~4 km), de uma grade fixa. Ajustar a
    área reaproveita o cache em `cache\osm\`.
  - No máximo 2 consultas ao mesmo tempo, como pede a política do Overpass.
  - Cada consulta tem **tempo limite de 60 s**: o app nunca fica esperando para sempre.
  - Se o servidor está ocupado (HTTP 429/503/504) ou não responde, o app tenta
    de novo esperando 5 s, depois 10 s, alternando entre o servidor principal
    (overpass-api.de) e dois espelhos. A tela mostra o motivo e a contagem
    regressiva ("Servidor ocupado… tentando de novo em 10 s").
  - Servidores que não respondem vão para o fim da fila durante a sessão.
  - Um bloco que falha 3 vezes é dividido em 4 pedaços menores. Um bloco que o
    Overpass diz ser grande demais é dividido na hora.
  - Cada bloco concluído é salvo no cache na hora: se você cancelar ou der
    erro, ele não é baixado de novo.
  - **Cancelar** (ao lado da barra de progresso) interrompe na hora.
  - Se algum pedaço não vier, o modelo é gerado mesmo assim. O app avisa quais
    camadas ficaram incompletas e marca esses pedaços **em vermelho no mapa**.
    Gere de novo mais tarde para completar.
  - Se o Overpass inteiro estiver fora do ar (muitas falhas seguidas), o app
    para de tentar e gera só com o que tiver.
- **STL único:** as camadas são fundidas ao terreno. Alguns prédios podem ficar
  como corpos separados do terreno por uma folga de ~0,0004 mm. O arquivo
  continua válido, e na impressão eles saem colados.

## 7. Estrutura do projeto

```
mapas3d/
  index.html            página do app
  src/
    main.ts             liga a interface aos módulos
    estilo.css
    core/               lógica pura (funciona no navegador e no Node)
      geo.ts            formas de seleção, medidas em metros, projeção, tiles
      estado.ts         definição dos parâmetros, presets + leitura/escrita na URL
      elevacao.ts       tiles Terrarium (AWS e Mapterhorn), "tile pai" quando falta zoom
      terreno.ts        grade → bloco sólido; triangulação adaptativa (Delatin)
      modelo.ts         recorte no formato da área, divisão em peças e em blocos
      camadas-impressao.ts  alinhamento de alturas às camadas de impressão
      limites.ts        faixas de tamanho de área e largura mínima imprimível
      osm.ts            leitura dos dados do OSM (prédios, vias, água, multipolígonos)
      vias.ts           tipos de via e larguras
      costa.ts          mar a partir das linhas de costa
      camadas.ts        geometria das camadas sobre o terreno (prédios … cobertura)
      categorias-osm.ts quais elementos do OSM o app usa e em que grupo
      cobertura.ts      configuração por categoria de cobertura do solo
      arvores.ts        posições das árvores (OSM + florestas)
      curvas.ts         curvas de nível (marching squares)
      raster.ts         máscara em grade para perguntas "dentro/fora" rápidas
      blocos.ts         divisão da área em blocos para o Overpass
      verificacao.ts    verificação de malha manifold
      manifold.ts       ponte com a biblioteca manifold-3d (booleanas e validação)
      stl.ts            leitura e escrita de STL binário
      predios-fontes.ts junta OSM e Overture sem duplicar (modo Automático)
      telhados.ts       telhados (roof:shape)
      atribuicoes.ts    atribuição das fontes de prédios
      tmf.ts            3MF multicolor e distribuição das cores nos 4 filamentos
      moldura.ts        moldura e plaquinha de texto
      texto.ts          texto → contornos (fontes TrueType)
    fontes/             fontes livres do texto (licença OFL ao lado de cada uma)
    navegador/          partes que só rodam no navegador
      mapa.ts           MapLibre e mapa de fundo
      desenho.ts        ferramentas de desenho e alças de edição
      painel.ts         controles do painel (número, cor, opções, faixas, seções)
      icones.ts         ícones do app (desenho próprio, SVG)
      aba-modelo.ts     aba Modelo
      aba-camadas.ts    aba Camadas
      osm-cliente.ts    baixa os blocos do OSM pelo servidor local
      unidades.ts       exibição em métrico ou imperial
      gerador.ts        conversa com o Web Worker
      previa.ts         pré-visualização 3D (Three.js)
      tiles.ts          baixa tiles pelo servidor local
    trabalhador/        Web Worker: gera o modelo sem travar a tela
  server/               servidor local (embutido no Vite) com cache em disco
    fontes.ts           tiles, Nominatim, cache e novas tentativas
    copernicus.ts       leitura parcial dos GeoTIFF do Copernicus
    overpass.ts         consultas ao Overpass (uma tentativa por pedido, 60 s)
    pbf.ts              leitor do formato .osm.pbf
    importador.ts       .osm.pbf → índice SQLite (npm run importar-osm)
    indice-osm.ts       consultas ao índice local e cobertura da área
    mapa-fundo.ts       cache do mapa de fundo (OpenFreeMap)
    extras.ts           prédios de outras fontes no índice local
    overture.ts         leitura dos GeoParquet do Overture (só os pedaços da região)
    prefeitura.ts       leitura de GeoJSON/shapefile e conversão de coordenadas
  scripts/              comandos npm run verificar, exemplo, importar-osm,
                        pre-carregar, importar-overture e importar-predios
    regioes.ts          regiões prontas para os comandos (ex.: df)
  dados-osm/            seus .osm.pbf e o índice gerado (fora do Git)
  cache/                tudo que foi baixado da internet (fora do Git)
  tests/                testes automáticos (Vitest)
```
