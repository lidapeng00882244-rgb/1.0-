// 检查依赖包
function checkDependencies() {
    const requiredModules = ['express', 'cors'];
    const missingModules = [];
    
    for (const module of requiredModules) {
        try {
            require.resolve(module);
        } catch (e) {
            missingModules.push(module);
        }
    }
    
    if (missingModules.length > 0) {
        console.error('\n[错误] 缺少必需的依赖包:');
        missingModules.forEach(m => console.error(`  - ${m}`));
        console.error('\n请运行以下命令安装依赖:');
        console.error('  npm install');
        console.error('');
        process.exit(1);
    }
}

// 启动前检查依赖
checkDependencies();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// 加载配置文件
let config = {};
try {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf-8');
        config = JSON.parse(configContent);
    } else {
        console.warn('[警告] 未找到 config.json，使用默认配置');
    }
} catch (error) {
    console.error('[错误] 读取配置文件失败:', error.message);
    console.log('使用默认配置');
}

// 从环境变量或配置文件获取配置
const PORT = process.env.PORT || config.port || 5000;
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || config.dashscope?.apiKey || '';
const MODEL = config.dashscope?.model || 'qwen-turbo';
const TEMPERATURE = config.dashscope?.temperature || 0.7;
const MAX_TOKENS = config.dashscope?.maxTokens || 2000;
const TEACHERS_FILE = config.data?.teachersFile || 'teachers.json';
const CASES_DIR = config.data?.casesDir || 'cases';

// 验证 API Key
if (!DASHSCOPE_API_KEY) {
    console.error('\n[错误] 未配置通义千问 API Key！');
    console.error('请在 config.json 中配置 dashscope.apiKey，或设置环境变量 DASHSCOPE_API_KEY');
    process.exit(1);
}

const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 提供静态文件服务：直接使用「2.0案例生成器」目录中的页面
const webDir = path.join(__dirname, '2.0案例生成器');
const indexPath = path.join(webDir, 'index.html');

// 注册静态文件服务
if (fs.existsSync(indexPath)) {
    app.use(express.static(webDir));
    console.log(`静态文件目录: ${webDir}`);
} else {
    console.warn(`[警告] 静态入口文件缺失: ${indexPath}`);
}

// 读取 teachers.json 文件
let teachersData = null;

function loadTeachersData() {
    try {
        const filePath = path.join(__dirname, TEACHERS_FILE);
        if (!fs.existsSync(filePath)) {
            console.error(`[错误] 未找到文件: ${TEACHERS_FILE}`);
            teachersData = [];
            return false;
        }
        const fileContent = fs.readFileSync(filePath, 'utf-8');
        teachersData = JSON.parse(fileContent);
        console.log(`成功加载 ${teachersData.length} 位老师数据`);
        return true;
    } catch (error) {
        console.error(`读取 ${TEACHERS_FILE} 失败:`, error.message);
        teachersData = [];
        return false;
    }
}

// 确保案例目录存在
function ensureCasesDir() {
    const casesPath = path.join(__dirname, CASES_DIR);
    if (!fs.existsSync(casesPath)) {
        fs.mkdirSync(casesPath, { recursive: true });
        console.log(`创建案例目录: ${CASES_DIR}`);
    }
}

// 启动时加载数据和创建目录
loadTeachersData();
ensureCasesDir();

// API: 获取所有老师数据
app.get('/api/teachers', (req, res) => {
    try {
        if (!teachersData) {
            loadTeachersData();
        }
        res.json({
            success: true,
            teachers: teachersData,
            count: teachersData ? teachersData.length : 0
        });
    } catch (error) {
        console.error('获取老师数据失败:', error);
        res.status(500).json({
            success: false,
            error: '获取老师数据失败'
        });
    }
});

// API: 匹配老师（优先匹配一致的公司和岗位，不足5位时用AI分析补充）
app.post('/api/match-teachers', async (req, res) => {
    try {
        const { direction, position } = req.body;
        
        if (!direction) {
            return res.status(400).json({
                success: false,
                error: '请提供求职方向'
            });
        }

        if (!teachersData) {
            loadTeachersData();
        }

        console.log(`开始匹配导师，求职方向：${direction}，岗位：${position || '未指定'}`);

        // 第一步：筛选出公司和岗位信息与求职方向、求职岗位一致的老师
        const exactMatchTeachers = teachersData.filter(teacher => {
            // 检查方向是否匹配
            if (!teacher.direction) return false;
            const directions = teacher.direction.split(/[、，,、\/]/).map(d => d.trim());
            const directionMatch = directions.some(d => d.includes(direction) || direction.includes(d));
            
            if (!directionMatch) return false;
            
            // 如果提供了岗位，检查岗位是否匹配
            if (position && position.trim()) {
                const teacherPosition = (teacher.position || '').toLowerCase();
                const teacherCompany = (teacher.company || '').toLowerCase();
                const searchPosition = position.toLowerCase().trim();
                
                // 检查岗位关键词是否匹配
                const positionMatch = teacherPosition.includes(searchPosition) || 
                                     searchPosition.includes(teacherPosition) ||
                                     // 检查公司是否包含相关关键词
                                     (searchPosition.includes('互联网') && (teacherCompany.includes('互联网') || teacherCompany.includes('科技') || teacherCompany.includes('软件'))) ||
                                     (searchPosition.includes('金融') && (teacherCompany.includes('金融') || teacherCompany.includes('银行') || teacherCompany.includes('证券'))) ||
                                     (searchPosition.includes('快消') && (teacherCompany.includes('快消') || teacherCompany.includes('消费')));
                
                return positionMatch;
            }
            
            return true; // 如果没有提供岗位，只要方向匹配即可
        });

        console.log(`精确匹配到 ${exactMatchTeachers.length} 位导师`);

        let selectedTeachers = [];
        let needAIAnalysis = false;
        let candidatesForAI = [];

        // 如果精确匹配的老师有5位或以上，直接返回前5位
        if (exactMatchTeachers.length >= 5) {
            selectedTeachers = exactMatchTeachers.slice(0, 5).map(teacher => ({
                ...teacher,
                match_type: 'exact',
                match_score: 100,
                match_reason: '公司和岗位信息与求职需求完全匹配'
            }));
            console.log(`精确匹配足够，返回前5位导师`);
        } else {
            // 精确匹配的老师不足5位，需要AI分析补充
            selectedTeachers = exactMatchTeachers.map(teacher => ({
                ...teacher,
                match_type: 'exact',
                match_score: 100,
                match_reason: '公司和岗位信息与求职需求完全匹配'
            }));

            // 准备AI分析的候选老师（排除已选中的）
            const selectedNames = selectedTeachers.map(t => t.name);
            candidatesForAI = teachersData.filter(teacher => !selectedNames.includes(teacher.name));
            
            needAIAnalysis = true;
            console.log(`精确匹配不足5位，需要AI分析补充 ${5 - selectedTeachers.length} 位`);
        }

        // 如果需要AI分析
        if (needAIAnalysis && candidatesForAI.length > 0) {
            const remainingCount = 5 - selectedTeachers.length;
            
            // 使用AI分析匹配度
            const matchPrompt = `请根据以下求职需求，从候选导师中筛选出最适合的${remainingCount}位导师，并按照匹配度从高到低排序。

求职方向：${direction}
${position ? `求职岗位：${position}` : '求职岗位：未指定'}

候选导师信息：
${candidatesForAI.map((teacher, index) => {
    return `导师${index}：
- 姓名：${teacher.name}
- 公司：${teacher.company || '未提供'}
- 职位：${teacher.position || '未提供'}
- 擅长方向：${teacher.direction || '未提供'}
- 教育背景：${teacher.education || '未提供'}
- 详细介绍：${teacher.information || '未提供'}
- 关键词：${teacher.keywords || '未提供'}`;
}).join('\n\n')}

请分析每位导师的专业背景、工作经历、擅长领域与求职需求的匹配度，筛选出最适合的${remainingCount}位导师。

请严格按照以下JSON格式返回结果，只返回JSON，不要有其他文字：
{
  "teachers": [
    {
      "index": 导师编号（从0开始，对应候选导师数组的索引）,
      "match_score": 匹配度分数（1-100，分数越高匹配度越高）,
      "match_reason": "匹配理由（简要说明为什么这位导师适合）"
    }
  ]
}

只返回最适合的${remainingCount}位导师，按匹配度从高到低排序。`;

            // 调用通义千问API进行匹配分析
            const aiResponse = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
                    'X-DashScope-Token': DASHSCOPE_API_KEY
                },
                body: JSON.stringify({
                    model: MODEL,
                    input: {
                        messages: [
                            {
                                role: 'user',
                                content: matchPrompt
                            }
                        ]
                    },
                    parameters: {
                        temperature: 0.3,
                        max_tokens: 2000
                    }
                })
            });

            const aiData = await aiResponse.json();
            
            if (aiResponse.ok && aiData.output) {
                let matchResult = null;
                
                // 解析AI返回的JSON
                if (aiData.output.text) {
                    try {
                        let jsonText = aiData.output.text.trim();
                        jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                        matchResult = JSON.parse(jsonText);
                    } catch (parseError) {
                        console.error('解析AI匹配结果失败:', parseError);
                        console.error('AI返回的文本:', aiData.output.text.substring(0, 500));
                    }
                }
                
                if (matchResult && matchResult.teachers && Array.isArray(matchResult.teachers)) {
                    // 根据AI返回的索引获取对应的老师
                    const aiSelected = matchResult.teachers
                        .filter(item => item.index >= 0 && item.index < candidatesForAI.length)
                        .map(item => ({
                            ...candidatesForAI[item.index],
                            match_type: 'ai',
                            match_score: item.match_score || 0,
                            match_reason: item.match_reason || 'AI分析推荐'
                        }))
                        .slice(0, remainingCount);
                    
                    selectedTeachers = [...selectedTeachers, ...aiSelected];
                    console.log(`AI分析成功，补充了 ${aiSelected.length} 位导师`);
                } else {
                    console.warn('AI返回格式不正确，使用备选方案');
                }
            } else {
                console.warn('AI匹配失败，使用备选方案');
            }

            // 如果AI分析后仍不足5位，使用备选方案补充
            if (selectedTeachers.length < 5) {
                const fallbackCount = 5 - selectedTeachers.length;
                const selectedNames = selectedTeachers.map(t => t.name);
                const fallbackTeachers = candidatesForAI
                    .filter(teacher => !selectedNames.includes(teacher.name))
                    .slice(0, fallbackCount)
                    .map(teacher => ({
                        ...teacher,
                        match_type: 'fallback',
                        match_score: 50,
                        match_reason: '备选推荐'
                    }));
                
                selectedTeachers = [...selectedTeachers, ...fallbackTeachers];
                console.log(`使用备选方案，补充 ${fallbackTeachers.length} 位导师`);
            }
        }

        // 确保返回正好5位（如果总数足够）
        selectedTeachers = selectedTeachers.slice(0, 5);

        res.json({
            success: true,
            teachers: selectedTeachers,
            count: selectedTeachers.length
        });
    } catch (error) {
        console.error('匹配老师失败:', error);
        res.status(500).json({
            success: false,
            error: '匹配老师失败: ' + error.message
        });
    }
});

// API: 生成案例（调用通义千问）
app.post('/api/generate-case', async (req, res) => {
    try {
        const { teacher, core_content, direction, position, customer_problems, highlights } = req.body;
        // 使用默认语言风格：专业严谨
        const language_style = 'professional';

        // 验证必需参数
        if (!teacher) {
            return res.status(400).json({
                success: false,
                error: '请提供老师信息'
            });
        }

        // 构建提示词
        const languageStyleMap = {
            'professional': '专业严谨',
            'warm': '亲和温婉',
            'inspiring': '热血励志',
            'direct': '干货直击'
        };

        const styleText = languageStyleMap[language_style] || '专业严谨';

        // 构建客户问题描述
        const problemMap = {
            'interview': '面试碰壁',
            'exam': '笔试碰壁',
            'resume': '简历投递无反馈',
            'career': '职业规划不明确'
        };
        
        let customerProblemsText = '- 未指定具体问题';
        if (customer_problems && customer_problems.length > 0) {
            customerProblemsText = customer_problems.map(prob => `- ${problemMap[prob] || prob}`).join('\n');
        }
        
        let customerProblemsList = '未指定';
        if (customer_problems && customer_problems.length > 0) {
            customerProblemsList = customer_problems.map(prob => problemMap[prob] || prob).join('、');
        }

        // 构建客户问题描述（用于故事部分）
        const problemDescriptions = {
            'interview': '面试碰壁，多次在面试环节被淘汰',
            'exam': '笔试碰壁，技术测试或笔试环节表现不佳',
            'resume': '简历投递无反馈，投递了大量简历但石沉大海',
            'career': '职业规划不明确，不知道自己的优势和适合的方向'
        };
        
        let customerProblemsDescription = '';
        if (customer_problems && customer_problems.length > 0) {
            customerProblemsDescription = customer_problems.map(prob => problemDescriptions[prob] || prob).join('、');
        }

        // 构建提示词
        let prompt = `请根据以下信息生成一份留学生求职案例报告，用于促单展示。

导师信息：
- 姓名：${teacher.name}
${teacher.company ? `- 公司：${teacher.company}` : ''}
${teacher.position ? `- 职位：${teacher.position}` : ''}
${teacher.direction ? `- 擅长方向：${teacher.direction}` : ''}
${teacher.education ? `- 教育背景：${teacher.education}` : ''}
${teacher.information ? `- 详细介绍：${teacher.information}` : ''}

客户求职信息：
- 求职方向：${direction || '未指定'}
${position ? `- 求职岗位：${position}` : ''}
- 客户遇到的问题：${customerProblemsDescription || '未指定'}
${highlights ? `- 需要突出的内容：${highlights}` : ''}

请生成一份案例报告，严格分为两部分：

【第一部分：背景介绍】
请快速介绍：
1. 导师背景（简要介绍导师的核心优势，突出其在${direction || '该领域'}的专业能力和成功经验）
2. 学员背景（杜撰一个海龟留学生案例，要求：
   - 学生是海龟留学生（可以来自美国、英国、澳洲、加拿大等国家）
   - 在国内求职
   - 求职方向与输入的"${direction || '未指定'}"类似，但不要完全一致（可以略有差异，比如输入"互联网"可以写成"互联网产品"或"互联网运营"等）
   - 如果提供了岗位"${position || ''}"，学员的岗位可以类似但不完全一致
   - 简要介绍学员的学历背景、专业、留学经历等）

【第二部分：成功故事】
请写一个约500字的详细故事，要求：
1. **辅导前的情况**（约150字）：
   - 详细描述学员在求职过程中遇到的困难和挫折
   - 重点描述学员遇到的问题：${customerProblemsDescription || '未指定'}
   - 描述学员的焦虑、迷茫、挫败感等情绪状态
   - 可以具体描述几次失败的面试经历或简历投递无果的情况
   - 突出学员在求职路上的无助和困境

2. **辅导过程和转折点**（约200字）：
   - 详细描述导师如何介入并提供帮助
   - 描述具体的辅导内容（简历优化、面试技巧指导、职业规划建议、内推资源、模拟面试等）
   - 描述导师的专业指导如何帮助学员突破瓶颈
   - 可以描述1-2个关键的转折点或突破时刻
   - 突出导师的专业能力和针对性解决方案

3. **辅导后的成果和对比**（约150字）：
   - 详细描述学员在导师辅导后的变化和提升
   - 对比辅导前后的状态（从迷茫到清晰、从失败到成功、从焦虑到自信等）
   - 最终成功上岸大厂名企（可以提及具体的知名企业，如：腾讯、阿里、字节跳动、美团、京东、百度、网易、小米、华为、中金、中信、四大等）
   - 可以描述成功拿到offer的喜悦和成就感
   - 强调导师辅导的关键作用和价值

4. **整体要求**：
   - 故事要有强烈的对比感，让读者感受到辅导前后的巨大变化
   - 语言要有感染力，能够引起共鸣
   - 内容要贴近现实，真实可信
   - 能够有效促单，让读者感受到导师辅导的重要性
   ${highlights ? `5. 特别强调：${highlights}` : ''}

要求：
- 语言专业严谨，但要有感染力
- 内容真实可信，逻辑清晰
- 突出导师的专业价值和辅导效果
- 能够有效促单，让读者感受到导师辅导的重要性

请直接输出两部分内容，不需要额外的标题或格式说明。`;

        // 调用通义千问 API（HTTP 方式，避免 SDK 依赖）
        const requestBody = {
            model: MODEL,
            input: {
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ]
            },
            parameters: {
                temperature: TEMPERATURE,
                max_tokens: MAX_TOKENS
            }
        };

        console.log('调用通义千问 API，模型:', MODEL);
        console.log('请求体长度:', JSON.stringify(requestBody).length);

        const aiResponse = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${DASHSCOPE_API_KEY}`,
                'X-DashScope-Token': DASHSCOPE_API_KEY
            },
            body: JSON.stringify(requestBody)
        });

        const data = await aiResponse.json();

        console.log('API 响应状态:', aiResponse.status);
        console.log('API 响应数据:', JSON.stringify(data).substring(0, 500));
        console.log('data.output 类型:', typeof data.output);
        console.log('data.output.text 存在:', !!data.output?.text);
        console.log('data.output.choices 存在:', !!data.output?.choices);

        // 检查响应状态（兼容 text / choices 两种返回格式）
        let generatedCase = null;
        if (aiResponse.ok && data.output) {
            // 优先检查 text 字段（通义千问新版本格式）
            if (data.output.text && typeof data.output.text === 'string') {
                generatedCase = data.output.text.trim();
                console.log('使用 text 字段，长度:', generatedCase.length);
            } 
            // 兼容 choices 格式（旧版本或某些模型）
            else if (data.output.choices && data.output.choices.length > 0) {
                if (data.output.choices[0].message?.content) {
                    generatedCase = data.output.choices[0].message.content.trim();
                    console.log('使用 choices[0].message.content，长度:', generatedCase.length);
                } else if (data.output.choices[0].text) {
                    generatedCase = data.output.choices[0].text.trim();
                    console.log('使用 choices[0].text，长度:', generatedCase.length);
                }
            }
        }

        if (generatedCase) {
            
            // 生成案例ID和时间戳
            const caseId = Date.now().toString();
            const timestamp = new Date().toISOString();
            
            // 保存案例到文件
            const caseData = {
                id: caseId,
                timestamp: timestamp,
                teacher: teacher,
                direction: direction || '',
                position: position || '',
                customer_problems: customer_problems || [],
                core_content: core_content,
                highlights: highlights || '',
                language_style: language_style || 'professional',
                case: generatedCase
            };
            
            try {
                const caseFilePath = path.join(__dirname, CASES_DIR, `${caseId}.json`);
                fs.writeFileSync(caseFilePath, JSON.stringify(caseData, null, 2), 'utf-8');
            } catch (saveError) {
                console.error('保存案例失败:', saveError.message);
                // 即使保存失败，也返回生成的案例
            }
            
            res.json({
                success: true,
                case: generatedCase,
                caseId: caseId,
                timestamp: timestamp
            });
        } else {
            // 提取详细的错误信息
            let errorMsg = '无法解析 API 响应';
            console.error('无法解析生成的案例，响应结构:', {
                hasOutput: !!data.output,
                outputType: typeof data.output,
                outputKeys: data.output ? Object.keys(data.output) : [],
                outputText: data.output?.text ? '存在' : '不存在',
                outputChoices: data.output?.choices ? `存在，长度: ${data.output.choices.length}` : '不存在',
                fullResponse: JSON.stringify(data).substring(0, 1000)
            });
            
            if (data.message) {
                errorMsg = data.message;
            } else if (data.output?.error?.message) {
                errorMsg = data.output.error.message;
            } else if (data.error?.message) {
                errorMsg = data.error.message;
            } else if (data.code) {
                errorMsg = `错误代码: ${data.code}, 消息: ${data.message || '无详细信息'}`;
            } else if (!data.output) {
                errorMsg = 'API 响应中缺少 output 字段';
            } else if (!data.output.text && !data.output.choices) {
                errorMsg = 'API 响应中 output 字段缺少 text 或 choices';
            }
            
            console.error('通义千问 API 调用失败:', {
                status_code: aiResponse.status,
                status_text: aiResponse.statusText,
                message: errorMsg
            });
            
            res.status(500).json({
                success: false,
                error: `通义千问 API 调用失败: ${errorMsg}`,
                details: {
                    status: aiResponse.status,
                    responsePreview: JSON.stringify(data).substring(0, 500)
                }
            });
        }
    } catch (error) {
        console.error('生成案例失败:', error);
        res.status(500).json({
            success: false,
            error: '生成案例失败: ' + (error.message || '未知错误')
        });
    }
});

// API: 保存案例
app.post('/api/save-case', (req, res) => {
    try {
        const { caseId, case: caseContent, teacher, direction, position, customer_problems, core_content, highlights } = req.body;
        // 使用默认语言风格：专业严谨
        const language_style = 'professional';
        
        if (!caseContent) {
            return res.status(400).json({
                success: false,
                error: '案例内容不能为空'
            });
        }
        
        const id = caseId || Date.now().toString();
        const timestamp = new Date().toISOString();
        
        const caseData = {
            id: id,
            timestamp: timestamp,
            teacher: teacher || {},
            direction: direction || '',
            position: position || '',
            customer_problems: customer_problems || [],
            core_content: core_content || '',
            highlights: highlights || '',
            language_style: language_style || 'professional',
            case: caseContent
        };
        
        const caseFilePath = path.join(__dirname, CASES_DIR, `${id}.json`);
        fs.writeFileSync(caseFilePath, JSON.stringify(caseData, null, 2), 'utf-8');
        
        res.json({
            success: true,
            message: '案例保存成功',
            caseId: id,
            timestamp: timestamp
        });
    } catch (error) {
        console.error('保存案例失败:', error);
        res.status(500).json({
            success: false,
            error: '保存案例失败: ' + error.message
        });
    }
});

// API: 获取案例历史列表
app.get('/api/cases', (req, res) => {
    try {
        const casesPath = path.join(__dirname, CASES_DIR);
        
        if (!fs.existsSync(casesPath)) {
            return res.json({
                success: true,
                cases: [],
                count: 0
            });
        }
        
        const files = fs.readdirSync(casesPath).filter(file => file.endsWith('.json'));
        const cases = [];
        
        for (const file of files) {
            try {
                const filePath = path.join(casesPath, file);
                const fileContent = fs.readFileSync(filePath, 'utf-8');
                const caseData = JSON.parse(fileContent);
                
                // 只返回摘要信息
                cases.push({
                    id: caseData.id,
                    timestamp: caseData.timestamp,
                    teacher: caseData.teacher?.name || '未知导师',
                    direction: caseData.direction || '',
                    preview: caseData.case ? caseData.case.substring(0, 100) + '...' : ''
                });
            } catch (error) {
                console.error(`读取案例文件 ${file} 失败:`, error.message);
            }
        }
        
        // 按时间倒序排序
        cases.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        res.json({
            success: true,
            cases: cases,
            count: cases.length
        });
    } catch (error) {
        console.error('获取案例列表失败:', error);
        res.status(500).json({
            success: false,
            error: '获取案例列表失败: ' + error.message
        });
    }
});

// API: 获取单个案例详情
app.get('/api/cases/:id', (req, res) => {
    try {
        const caseId = req.params.id;
        const caseFilePath = path.join(__dirname, CASES_DIR, `${caseId}.json`);
        
        if (!fs.existsSync(caseFilePath)) {
            return res.status(404).json({
                success: false,
                error: '案例不存在'
            });
        }
        
        const fileContent = fs.readFileSync(caseFilePath, 'utf-8');
        const caseData = JSON.parse(fileContent);
        
        res.json({
            success: true,
            case: caseData
        });
    } catch (error) {
        console.error('获取案例详情失败:', error);
        res.status(500).json({
            success: false,
            error: '获取案例详情失败: ' + error.message
        });
    }
});

// API: 删除案例
app.delete('/api/cases/:id', (req, res) => {
    try {
        const caseId = req.params.id;
        const caseFilePath = path.join(__dirname, CASES_DIR, `${caseId}.json`);
        
        if (!fs.existsSync(caseFilePath)) {
            return res.status(404).json({
                success: false,
                error: '案例不存在'
            });
        }
        
        fs.unlinkSync(caseFilePath);
        
        res.json({
            success: true,
            message: '案例删除成功'
        });
    } catch (error) {
        console.error('删除案例失败:', error);
        res.status(500).json({
           	success: false,
            error: '删除案例失败: ' + error.message
        });
    }
});

// 根路径重定向到 index.html（保证文件存在后再发送）
app.get('/', (req, res) => {
    if (fs.existsSync(indexPath)) {
        return res.sendFile(indexPath);
    }
    res.status(500).send('静态入口文件缺失，请检查部署包是否包含 2.0案例生成器/index.html');
});

// 健康检查接口
app.get('/health', (req, res) => {
    res.json({
        success: true,
        message: '服务运行正常',
        teachersCount: teachersData ? teachersData.length : 0,
        config: {
            port: PORT,
            model: MODEL,
            casesDir: CASES_DIR
        }
    });
});

// 启动服务器
const server = app.listen(PORT, () => {
    console.log('========================================');
    console.log('   服务器启动成功！');
    console.log('========================================');
    console.log(`服务器地址: http://localhost:${PORT}`);
    console.log(`已加载 ${teachersData ? teachersData.length : 0} 位老师数据`);
    console.log('========================================');
    console.log('可用接口:');
    console.log('  GET  /api/teachers - 获取所有老师');
    console.log('  POST /api/match-teachers - 匹配老师');
    console.log('  POST /api/generate-case - 生成案例');
    console.log('  POST /api/save-case - 保存案例');
    console.log('  GET  /api/cases - 获取案例历史列表');
    console.log('  GET  /api/cases/:id - 获取案例详情');
    console.log('  DELETE /api/cases/:id - 删除案例');
    console.log('  GET  /health - 健康检查');
    console.log('========================================');
    console.log('按 Ctrl+C 停止服务器');
    console.log('');
});

// 错误处理
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`\n[错误] 端口 ${PORT} 已被占用！`);
        console.error('请关闭占用该端口的程序，或修改 server.js 中的 PORT 值');
        console.error('\n提示: 可以使用以下命令查找占用端口的进程:');
        console.error(`  netstat -ano | findstr :${PORT}`);
    } else {
        console.error('\n[错误] 服务器启动失败:', error.message);
    }
    process.exit(1);
});

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
    console.error('\n[严重错误] 未捕获的异常:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('\n[警告] 未处理的 Promise 拒绝:', reason);
});

