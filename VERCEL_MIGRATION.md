# Migração do projeto Arenza Moda Íntima do Netlify para a Vercel

Este guia reúne um passo a passo detalhado para migrar o site estático e o domínio da Arenza Moda Íntima do Netlify para a Vercel, preservando o fluxo com Supabase.

## 1. Preparação local
1. Certifique-se de ter o [Vercel CLI](https://vercel.com/docs/cli) instalado:
   ```bash
   npm i -g vercel
   ```
2. Faça login:
   ```bash
   login vercel
   ```
3. No diretório do projeto (`/workspace/Arenza-moda-intima`), execute:
   ```bash
   link vercel
   ```
   * Escolha ou crie um time/projeto na Vercel.

## 2. Ajustes de código para as Functions
O projeto usa uma Function Netlify ( `netlify/functions/get-config.js` ) para expor as variáveis ​​do Supabase. Migre-a para a Vercel criando `api/get-config.js` (exemplo em CommonJS já presente no repositório):
```javascript
módulo.exportações = (req, res) => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL } = processo.env;

  const faltando = [];
  se (!SUPABASE_URL) estiver faltando.push('SUPABASE_URL');
  se (!SUPABASE_ANON_KEY) estiver faltando.push('SUPABASE_ANON_KEY');

  se (faltando.length > 0) {
    res.status(200).json({
      url: nulo,
      anonKey: nulo,
      adminEmail: ADMIN_EMAIL || nulo,
      error: `Supabase credentials are missing (${missing.join(', ')}). Defina-as nas variáveis de ambiente.`
    });
    retornar;
  }

  res.status(200).json({
    url: SUPABASE_URL,
    anonKey: SUPABASE_ANON_KEY,
    adminEmail: ADMIN_EMAIL || nulo
  });
};
```
* Atualize `app.js` para buscar `/.netlify/functions/get-config`**ou** a nova rota `/api/get-config` (o script já trata ambas).
 
* Remova arquivos específicos do Netlify (`netlify.toml`, pasta `netlify/`) após validar a nova rota.
* Ao testar o endpoint na Vercel, um JSON com campos `null` virá acompanhado de `error` indicando quais variáveis faltam — ajuste-as antes do deploy final.

## 3. Configuração do projeto na Vercel
1. Acesse o painel da Vercel e crie um novo projeto conectado ao repositório Git (GitHub/GitLab/Bitbucket) ou suba manualmente via CLI.
2. Defina o **framework** como "Other" (site estático) e configure a pasta de saída como `.` (raiz). Não há passo de build além de servir arquivos estáticos.
3. No painel **Settings → Environment Variables**, cadastre:
   * `SUPABASE_URL` 
   * `SUPABASE_ANON_KEY` 
   * `EMAIL_ADMIN` 
4. Se usar Preview Deployments, replique as variáveis para os ambientes *Preview* e *Development* conforme necessário.

## 4. Implantação inicial
1. Realize um deploy via CLI para gerar o preview e confirmar que tudo funciona:
   ```bash
   vercel --prod
   ```
   ou aprove o deploy via Git push.
2. Acesse a URL temporária para validar autenticação, CRUD e carregamento dos produtos.

## 5. Migração do domínio
1. No Netlify, remova a configuração de DNS do domínio personalizado para liberar os registros.
2. Na Vercel, em **Domains**, adicione `seu-dominio.com`.
3. Atualize os registros DNS no provedor (ou transfira o domínio para a Vercel) apontando:
   *`A` para `76.76.21.21` (ou use registros `CNAME` conforme instruções da Vercel).
 
   * Se houver subdomínios, utilize os registros sugeridos na tela de verificação.
4. Aguarde a propagação (até 24h). A Vercel emitirá automaticamente certificados SSL (Let's Encrypt).

## 6. Pós-migração
1. Verifique logs da Function em **Vercel → Project → Functions** para confirmar respostas 200.
2. Atualize qualquer webhook (Supabase, formulários etc.) que apontava para o domínio antigo.
3. Desative o site no Netlify para evitar custos e deploys acidentais.
4. Documente para a equipe o novo fluxo de deploy: push para a branch principal = deploy automático na Vercel.

## 7. Dicas adicionais
* Para variáveis sensíveis em ambiente local, use um arquivo `.env.local` com o mesmo conteúdo e rode `vercel dev` durante o desenvolvimento.
* Configure **Analytics** e **Monitoring** na Vercel, se desejar, para substituir eventuais métricas do Netlify.
* Se futuramente precisar de SSR/Edge, você já estará em uma plataforma compatível.

Seguindo esses passos, seu site e domínio sairão do Netlify e passarão a operar integralmente na Vercel, mantendo o backend Supabase intacto.