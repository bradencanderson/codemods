function isBoundToThis(node) {
    node = node.value;
    if (node.arguments.length === 1 && node.arguments[0].type === 'ThisExpression') {
        // We are calling with a single argument: `this`
        if (node.callee.property && node.callee.property.name === 'bind') {
            // We are calling `.bind()`
            const method = node.callee.object;
            if (method.type === 'MemberExpression') {
                // The method being called is like `obj.someMethod`
                if (method.object.type === 'ThisExpression') {
                    // The method being called is like `this.someMethod`
                    return true;
                }
            }
        }
    }
    return false;
}

const transform = (fileInfo, api, options) => {
    const j = api.jscodeshift;

    function convertMethodToBoundArrowFunc(method) {
        const name = method.value.key;

        const { params, body } = method.value.value;
        const arrowFunc = j.arrowFunctionExpression(
            params,
            body,
        );
        const classProp = j.classProperty(
            name,
            arrowFunc,
            null, /* typeAnnotation */
            false, /* static */
        );
        classProp.comments = method.value.comments;
        return classProp;
    }

    function findAndRemoveBind(classBody) {
        // Find expressions of the form `this.foo.bind(this)`
        // and convert them to `this.foo`
        const exprs = classBody.find(j.MethodDefinition)
            // Ignore calls in the constructor
            .filter((node) => node.value.kind !== 'constructor')
            .find(j.CallExpression)

            // .filter()
            .filter(isBoundToThis);

        // Get a list of methods on the class
        const methodNames = [];
        classBody.find(j.MethodDefinition)
            .forEach((method) => {
                method = method.value;
                methodNames.push(method.key.name);
            });

        const methodsToBeConverted = [];
        exprs.replaceWith((boundMethod) => {
            // Looks like `this.someMethod`
            const unboundMethod = boundMethod.value.callee.object;

            // Remove calls to `.bind(this)` and find methods to be converted
            const methodName = unboundMethod.property.name;
            if (methodsToBeConverted.includes(methodName)) {
                return boundMethod.value.callee.object;
            } else if (methodNames.includes(methodName)) {
                methodsToBeConverted.push(methodName);
                return boundMethod.value.callee.object;
            } else {
                return boundMethod;
            }
        });

        // Convert methods to bound arrow functions
        classBody
            .find(j.MethodDefinition, (node) => methodsToBeConverted.includes(node.key.name))
            .replaceWith(convertMethodToBoundArrowFunc);
    }

    const ast = j(fileInfo.source);

    const classes = ast.find(j.ClassDeclaration);
    classes.forEach(_class => findAndRemoveBind(j(_class)));

    return ast.toSource({
        arrowParensAlways: true,
    });
};

export default transform;
