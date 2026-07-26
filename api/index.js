import express from 'express';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';

let prisma;
if (!global.prisma) {
  global.prisma = new PrismaClient();
}
prisma = global.prisma;

const app = express();

app.use(
  cors({
    origin: ['https://sky10024.dothome.co.kr'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  })
);
app.use(express.json());

function getUserIdFromReq(req) {
  const auth = req.headers.authorization;
  if (!auth) return null;
  const token = auth.replace('Bearer ', '').trim();
  const match = token.match(/^fake-jwt-token-(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function requireAuth(req, res, next) {
  try {
    const userId = getUserIdFromReq(req);
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(401).json({ error: '유효하지 않은 사용자입니다.' });
    req.userId = user.id;
    req.userRole = user.role;
    next();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '인증 처리 중 오류가 발생했습니다.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.userRole !== 'admin') return res.status(403).json({ error: '관리자만 접근 가능합니다.' });
  next();
}

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, nickname } = req.body;
    if (!email || !password || !nickname) {
      return res.status(400).json({ error: '모든 항목을 입력해 주세요.' });
    }
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ error: '이미 존재하는 이메일입니다.' });
    }
    const user = await prisma.user.create({
      data: { email, password, nickname },
    });
    const token = `fake-jwt-token-${user.id}`;
    res.json({
      token,
      user: { id: user.id, email: user.email, nickname: user.nickname, role: user.role },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '회원가입 처리 중 오류가 발생했습니다.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.password !== password) {
      return res.status(400).json({ error: '이메일 또는 비밀번호가 일치하지 않습니다.' });
    }
    const token = `fake-jwt-token-${user.id}`;
    res.json({
      token,
      user: { id: user.id, email: user.email, nickname: user.nickname, role: user.role },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다.' });
  }
});

app.get('/api/posts', async (req, res) => {
  try {
    const { category, q } = req.query;
    const where = {};
    if (category) where.category = String(category);
    if (q) {
      where.OR = [
        { title: { contains: String(q) } },
        { body: { contains: String(q) } },
      ];
    }
    const posts = await prisma.post.findMany({
      where,
      include: { author: { select: { nickname: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(posts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '게시글 목록을 불러오는 데 실패했습니다.' });
  }
});

app.get('/api/posts/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        author: { select: { nickname: true } },
        comments: {
          include: { author: { select: { nickname: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!post) {
      return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
    }
    res.json(post);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '게시글 조회에 실패했습니다.' });
  }
});

app.post('/api/posts', requireAuth, async (req, res) => {
  try {
    const { category, title, body } = req.body;
    if (!category || !title || !body) {
      return res.status(400).json({ error: '카테고리, 제목, 본문은 필수입니다.' });
    }
    const post = await prisma.post.create({
      data: { category, title, body, authorId: req.userId },
      include: { author: { select: { nickname: true } } },
    });
    res.json(post);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '게시글 작성에 실패했습니다.' });
  }
});

app.delete('/api/posts/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const post = await prisma.post.findUnique({ where: { id } });
    if (!post) {
      return res.status(404).json({ error: '게시글을 찾을 수 없습니다.' });
    }
    if (post.authorId !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({ error: '삭제 권한이 없습니다.' });
    }
    await prisma.post.delete({ where: { id } });
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '게시글 삭제에 실패했습니다.' });
  }
});

app.post('/api/posts/:id/comments', async (req, res) => {
  try {
    const postId = Number(req.params.id);
    const { content } = req.body;
    if (!content) {
      return res.status(400).json({ error: '댓글 내용을 입력해주세요.' });
    }
    const authorId = getUserIdFromReq(req);
    const comment = await prisma.comment.create({
      data: { postId, content, authorId },
      include: { author: { select: { nickname: true } } },
    });
    res.json(comment);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '댓글 등록에 실패했습니다.' });
  }
});

app.get('/api/reports', async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? { status: String(status) } : {};
    const reports = await prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
    res.json(reports);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '피해제보 목록 조회 실패' });
  }
});

app.post('/api/reports', async (req, res) => {
  try {
    const { site, type, description } = req.body;
    if (!site || !type || !description) {
      return res.status(400).json({ error: '모든 입력 항목을 작성해주세요.' });
    }
    const report = await prisma.report.create({
      data: { site, type, description },
    });
    res.json(report);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '피해제보 등록 실패' });
  }
});

app.patch('/api/reports/:id/status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body;
    const ALLOWED_STATUS = ['pending', 'success', 'cancel'];
    if (!status || !ALLOWED_STATUS.includes(status)) {
      return res.status(400).json({ error: '올바르지 않은 상태 값입니다.' });
    }
    const existing = await prisma.report.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: '제보를 찾을 수 없습니다.' });
    }
    const report = await prisma.report.update({ where: { id }, data: { status } });
    res.json(report);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: '상태 변경에 실패했습니다.' });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, dbAvailable: true });
  } catch (error) {
    res.json({ ok: true, dbAvailable: false });
  }
});

export default app;